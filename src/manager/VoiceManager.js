import io from "socket.io-client";

const VOICE_BYPASS_SPATIAL = false;     // bypass the whole 3D spatializer
const VOICE_IGNORE_DISTANCE = false;      // keep the player in the graph but disable distance
const VOICE_ATTACH_RAW_AUDIO = true;     // create a hidden <audio> element for each stream

export default class VoiceManager {
    constructor(token, onPlayersUpdate) {
        this.token = token;
        this.onPlayersUpdate = typeof onPlayersUpdate === "function" ? onPlayersUpdate : () => {
        };

        this.socket = null;
        this.localMicStream = null;
        this.peerConnections = {};
        this.playerPositions = {};

        this.audioContext = null;
        this.masterGainNode = null;
        this.outputDestination = null;
        this.outputAudioElement = null;

        this.positionTicker = null;
        this.mutedPlayerIds = new Set();
        this.presenceList = [];
        this.onPresenceCallback = null;

        this.debug = {
            get DIRECT() {
                if (typeof window !== "undefined" && ("__VOICE_DEBUG_DIRECT__" in window)) {
                    return !!window.__VOICE_DEBUG_DIRECT__;
                }
                return !!VOICE_BYPASS_SPATIAL ;
            }, get RELAX() {
                if (typeof window !== "undefined" && ("__VOICE_DEBUG_RELAX__" in window)) {
                    return !!window.__VOICE_DEBUG_RELAX__;
                }
                return !!VOICE_IGNORE_DISTANCE ;
            }, get PEER_AUDIO_TAG() {
                if (typeof window !== "undefined" && ("__VOICE_DEBUG_PEER_AUDIO_TAG__" in window)) {
                    return !!window.__VOICE_DEBUG_PEER_AUDIO_TAG__;
                }
                return !!VOICE_ATTACH_RAW_AUDIO;
            }
        };

        this.positionsPrimed = false;

        this.turnConfig = null;

        this.levelCallback = null;
        this.levelTicker = null;
        this.selfAnalyser = null;
        this.selfTimeData = null;
        this.peerAnalysers = {};
        this.peerTimeData = {};
    }

    getIceConfig() {
        return {
            iceServers: [{urls: "stun:stun.l.google.com:19302"},]
        };
    }


    async connect(inputDeviceId) {
        const baseAudioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            googNoiseSuppression: true,
            googEchoCancellation: true,
            googAutoGainControl: true,
            highpassFilter: true
        };

        const audioConstraints = inputDeviceId && inputDeviceId !== "default" ? {
            ...baseAudioConstraints,
            deviceId: {exact: inputDeviceId}
        } : baseAudioConstraints;

        this.localMicStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraints});

/*        const localTrack = this.localMicStream?.getAudioTracks?.()[0];
        if (localTrack) {
            localTrack.onmute = () => console.warn("[VOICE][LOCAL] track muted");
            localTrack.onunmute = () => console.warn("[VOICE][LOCAL] track unmuted");
            localTrack.onended = () => console.warn("[VOICE][LOCAL] track ended");
        }

*/

        this.initializeAudioOutputIfNeeded();

        try {
            if (this.audioContext && this.localMicStream) {
                const localSrc = this.audioContext.createMediaStreamSource(this.localMicStream);
                const analyser = this.audioContext.createAnalyser();
                analyser.fftSize = 1024;
                analyser.smoothingTimeConstant = 0.2;
                localSrc.connect(analyser);
                this.selfAnalyser = analyser;
                this.selfTimeData = new Float32Array(analyser.fftSize);
                this.ensureLevelTicker();
            }
        } catch (e) {
            //console.warn("[VOICE] Failed to initialize local analyser", e);
        }

        try {
            const res = await fetch("/ice-config", {credentials: "include"});
            const json = await res.json();

            if (json && Array.isArray(json.iceServers)) {
                this.turnConfig = {iceServers: json.iceServers};
            }
        } catch (err) {
            this.turnConfig = this.getIceConfig();
        }

        this.socket = io({query: {code: this.token}});

        this.socket.on("new-peer", ({id, initiator}) => {
            console.log(`[VOICE] Peer joined: ${id} (${initiator ? "initiator" : "receiver"})`);
            if (!id) return;
            if (!this.peerConnections[id]) this.createPeerConnection(id, !!initiator);
        });

        this.socket.on("signal", ({from, signal}) => this.handleSignalingMessage(from, signal));

        this.socket.on("update-position", ({id, pos, username}) => this.setPlayerPosition(id, pos, username));

        this.socket.on("remove-peer", (id) => this.removePeerConnection(id));

        this.socket.on("presence", (payload) => {
            if (payload?.list) {
                this.presenceList = payload.list;
                this.onPresenceCallback?.(this.getActiveVoiceUsers());
            }
        });

        await new Promise((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                this.socket?.off?.("connection-accepted", onAccepted);
                this.socket?.off?.("already-connected", onAlready);
                this.socket?.off?.("disconnect", onDisconnect);
                if (timer) clearTimeout(timer);
            };

            const onAccepted = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const onAlready = () => {
                if (settled) return;
                settled = true;
                cleanup();
                const e = new Error("Already connected");
                e.code = "ALREADY_CONNECTED";
                reject(e);
            };

            const onDisconnect = () => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("Socket disconnected before acceptance"));
            };

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("CONNECT_TIMEOUT"));
            }, 10000);

            this.socket?.once?.("connection-accepted", onAccepted);
            this.socket?.once?.("already-connected", onAlready);
            this.socket?.once?.("disconnect", onDisconnect);
        });

        this.positionTicker = setInterval(() => {
            if (this.socket?.connected && this.playerPositions?.me && this.audioContext?.listener) {
                this.socket.emit("position", this.playerPositions.me);

                const me = this.playerPositions.me;

                this.audioContext.listener.positionX.value = me.x ?? 0;
                this.audioContext.listener.positionY.value = me.y ?? 0;
                this.audioContext.listener.positionZ.value = me.z ?? 0;

                const yaw = typeof me.yaw === "number" ? me.yaw : 0;
                const yawRad = (yaw * Math.PI) / 180;

                this.audioContext.listener.forwardX.value = -Math.sin(yawRad);
                this.audioContext.listener.forwardZ.value = Math.cos(yawRad);
                this.audioContext.listener.forwardY.value = 0;

                this.audioContext.listener.upX.value = 0;
                this.audioContext.listener.upY.value = 1;
                this.audioContext.listener.upZ.value = 0;
            }

            Object.keys(this.peerConnections || {}).forEach((pid) => this.updateSpatialAudioForPeer(pid));
        }, 500);
    }


    initializeAudioOutputIfNeeded() {
        if (this.audioContext && this.masterGainNode && this.outputDestination && this.outputAudioElement) {
            return;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioCtx();

        this.masterGainNode = this.audioContext.createGain();
        this.outputDestination = this.audioContext.createMediaStreamDestination();
        this.masterGainNode.connect(this.outputDestination);

        const el = document.createElement("audio");
        el.autoplay = true;
        el.playsInline = true;
        el.srcObject = this.outputDestination.stream;
        el.style.display = "none";
        document.body.appendChild(el);
        this.outputAudioElement = el;

        this.outputAudioElement.muted = false;
        this.outputAudioElement.volume = 1;

        try {
            const playPromise = el.play();
            if (playPromise && typeof playPromise.then === "function") {
                playPromise.catch((err) => {
                    console.warn("Audio playback was blocked by the browser:", err);
                });
            }
        } catch (err) {
            console.warn("Failed to start audio playback:", err);
        }

        if (this.audioContext.state === "suspended") {
            this.audioContext.resume().catch(() => {
            });
        }
    }

    createPeerConnection(id, initiator) {
        const iceConfig = this.turnConfig || this.getIceConfig();
        const pc = new RTCPeerConnection(iceConfig);
        this.peerConnections[id] = {pc, initiator};

        const tracks = this.localMicStream?.getAudioTracks?.() || [];

        if (tracks.length) {
            tracks.forEach((track) => {
                try {
                    pc.addTrack(track, this.localMicStream);
                } catch (e) {
                    console.error("addTrack failed for peer", id, e);
                }
            });
        } else {
            console.warn(`[VOICE] Tried to connect to ${id}, but no mic track was found.`);
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket?.emit?.("signal", {
                    targetId: id, signal: {
                        type: "candidate", candidate: event.candidate
                    }
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            // console.log("ICE connection state for", id, pc.iceConnectionState, pc.connectionState);
        };

        pc.onicegatheringstatechange = () => {
            // console.log("ICE gathering state for", id, pc.iceGatheringState);
        };

        pc.onicecandidateerror = (e) => {
            // console.warn("ICE error for", id, e?.errorCode, e?.errorText || e);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") {
                this.removePeerConnection(id);
            }
        };

        pc.ontrack = (event) => {
            console.log(`[VOICE] Receiving audio from ${id}`);

            /*if (event.track) {
                event.track.onmute = () => console.warn("[VOICE][REMOTE]", id, "track muted");
                event.track.onunmute = () => console.warn("[VOICE][REMOTE]", id, "track unmuted");
                event.track.onended = () => console.warn("[VOICE][REMOTE]", id, "track ended");
            }*/

            const inboundStream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
            this.setupSpatialAudioNodes(id, inboundStream);

            try {
                if (this.audioContext?.state === "suspended") {
                    this.audioContext.resume().catch(() => {
                    });
                }
                const p = this.outputAudioElement?.play?.();
                if (p && typeof p.then === "function") p.catch(() => {
                });
            } catch (_) {
            }
        };

        if (initiator) {
            pc.onnegotiationneeded = async () => {
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);

                    this.socket?.emit?.("signal", {
                        targetId: id, signal: {
                            type: "offer", sdp: pc.localDescription
                        }
                    });
                } catch (err) {
                    console.error(`[VOICE] Offer failed for ${id}`, err);
                }
            };
        }

        return pc;
    }

    async handleSignalingMessage(from, signal) {
        if (!from || !signal) return;

        if (!this.peerConnections[from]) {
            this.createPeerConnection(from, false);
        }

        const {pc} = this.peerConnections[from] || {};
        if (!pc) {
            console.warn(`[VOICE] Signal received from ${from}, but no peer connection exists.`);
            return;
        }

        try {
            switch (signal.type) {
                case "offer": {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);

                    this.socket?.emit?.("signal", {
                        targetId: from, signal: {
                            type: "answer", sdp: pc.localDescription
                        }
                    });
                    break;
                }

                case "answer": {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                    break;
                }

                case "candidate": {
                    if (!signal.candidate) return;
                    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                    break;
                }

                default:
                    console.warn(`[VOICE] Unknown signal from ${from}:`, signal?.type);
            }
        } catch (err) {
            console.error("Error handling signal from", from, err);
        }
    }

    setupSpatialAudioNodes(id, stream) {
        if (!this.audioContext || !this.masterGainNode) return;

        const entry = this.peerConnections[id] || (this.peerConnections[id] = {});

        if (entry._nodes) {
            entry._nodes?.source?.disconnect();
            entry._nodes?.panner?.disconnect();
            entry._nodes?.gain?.disconnect();
        }

        if (this.debug.PEER_AUDIO_TAG) {
            try {
                if (entry._peerAudioEl) {
                    entry._peerAudioEl.pause?.();
                    entry._peerAudioEl.srcObject = null;
                    entry._peerAudioEl.remove?.();
                }
                const tag = document.createElement("audio");
                tag.autoplay = true;
                tag.playsInline = true;
                tag.muted = false;
                tag.srcObject = stream;
                tag.style.display = "none";
                document.body.appendChild(tag);
                entry._peerAudioEl = tag;
            } catch (e) {
                console.warn(`[VOICE] Could not attach debug audio element for ${id}`, e);
            }
        }

        const source = this.audioContext.createMediaStreamSource(stream);

        const panner = new PannerNode(this.audioContext, {
            panningModel: "HRTF",
            distanceModel: "linear",
            refDistance: 1,
            maxDistance: 40,
            rolloffFactor: 1,
            coneInnerAngle: 360,
            coneOuterAngle: 0,
            coneOuterGain: 0
        });

        const gain = this.audioContext.createGain();
        if (!this.mutedPlayerIds) this.mutedPlayerIds = new Set();
        gain.gain.value = this.mutedPlayerIds.has(id) ? 0 : 1;

        if (this.debug.DIRECT) {
            source.connect(gain);
        } else {
            source.connect(panner);
            panner.connect(gain);
        }
        gain.connect(this.masterGainNode);

        try {
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.2;
            source.connect(analyser);
            this.peerAnalysers[id] = analyser;
            this.peerTimeData[id] = new Float32Array(analyser.fftSize);
            this.ensureLevelTicker();
            entry._analyser = analyser;
        } catch (e) {
            console.warn("[VOICE] Failed to create analyser for peer", id, e);
        }

        entry._nodes = {source, panner, gain};

        const me = this.playerPositions?.me;
        const pos = this.playerPositions?.[id];
        console.log("[VOICE] Created nodes for", id, {
            gain: gain.gain.value,
            meWorld: me?.world,
            peerWorld: pos?.world,
            debug: {DIRECT: this.debug.DIRECT, RELAX: this.debug.RELAX}
        });

        this.updateSpatialAudioForPeer(id);
    }

    attachLevels(callback) {
        this.levelCallback = typeof callback === "function" ? callback : null;
        this.ensureLevelTicker();
        return () => {
            if (this.levelCallback === callback) this.levelCallback = null;
            this.stopLevelTickerIfIdle();
        };
    }

    ensureLevelTicker() {
        if (this.levelTicker || !this.audioContext) return;
        const tick = () => {
            this.levelTicker = requestAnimationFrame(tick);
            if (!this.levelCallback) return;
            const levels = {self: 0, peers: {}};
            // self level
            try {
                if (this.selfAnalyser && this.selfTimeData) {
                    this.selfAnalyser.getFloatTimeDomainData(this.selfTimeData);
                    levels.self = this.computeRms(this.selfTimeData);
                }
            } catch (_) {}
            try {
                for (const id in this.peerAnalysers) {
                    const an = this.peerAnalysers[id];
                    let buf = this.peerTimeData[id];
                    if (!buf || buf.length !== an.fftSize) {
                        buf = new Float32Array(an.fftSize);
                        this.peerTimeData[id] = buf;
                    }
                    an.getFloatTimeDomainData(buf);
                    levels.peers[id] = this.computeRms(buf);
                }
            } catch (_) {}
            try {
                this.levelCallback(levels);
            } catch (e) {
            }
        };
        this.levelTicker = requestAnimationFrame(tick);
    }

    stopLevelTickerIfIdle() {
        if (!this.levelCallback && this.levelTicker) {
            cancelAnimationFrame(this.levelTicker);
            this.levelTicker = null;
        }
    }

    computeRms(buffer) {
        let squaredSum = 0;
        let maxAbs = 0;

        for (let i = 0; i < buffer.length; i++) {
            const value = buffer[i] || 0;
            squaredSum += value * value;

            const absValue = value < 0 ? -value : value;
            if (absValue > maxAbs) {
                maxAbs = absValue;
            }
        }

        const rms = Math.sqrt(squaredSum / (buffer.length || 1)) || 0;

        const level = Math.max(rms, maxAbs * 0.5);
        const db = 20 * Math.log10(level + 1e-8);

        const rangeMin = -60;
        const rangeMax = 0;
        let normalized = (db - rangeMin) / (rangeMax - rangeMin);

        if (!Number.isFinite(normalized)) {
            normalized = 0;
        }

        normalized = Math.min(1, Math.max(0, normalized));
        return Math.pow(normalized, 0.9);
    }


    updateSpatialAudioForPeer(id) {
        const entry = this.peerConnections[id];
        const nodes = entry?._nodes;
        const me = this.playerPositions?.me;
        const pos = this.playerPositions?.[id];

        if (!nodes) return;

        if (me && pos && !this.positionsPrimed) this.positionsPrimed = true;

        if (this.debug.RELAX || !this.positionsPrimed) {
            nodes.panner.positionX.value = 0;
            nodes.panner.positionY.value = 0;
            nodes.panner.positionZ.value = 0;
            nodes.gain.gain.value = this.mutedPlayerIds.has(id) ? 0 : 1;
            return;
        }

        if (!me || !pos) return;

        if (pos.world !== me.world) {
            if (this.debug.RELAX) {
                nodes.panner.positionX.value = 0;
                nodes.panner.positionY.value = 0;
                nodes.panner.positionZ.value = 0;
            } else {
                nodes.panner.positionX.value = 99999;
                nodes.panner.positionY.value = 0;
                nodes.panner.positionZ.value = 0;
            }
            console.log(`[VOICE] ${id} is in a different world (${pos.world}). Muted by distance.`);
            return;
        }

        nodes.panner.positionX.value = pos.x - me.x;
        nodes.panner.positionY.value = pos.y - me.y;
        nodes.panner.positionZ.value = pos.z - me.z;

        if (!entry._lastLog || Date.now() - entry._lastLog > 3000) {
            console.log("[VOICE] Updated location for", id, "dx/dy/dz=", nodes.panner.positionX.value, nodes.panner.positionY.value, nodes.panner.positionZ.value);
            entry._lastLog = Date.now();
        }
    }

    setPlayerPosition(id, pos, username) {
        this.playerPositions[id] = {...pos, username: username || "Player"};
        if (id === this.socket?.id) this.playerPositions.me = this.playerPositions[id];
        this.refreshNearbyPlayers();
        Object.keys(this.peerConnections).forEach((pid) => this.updateSpatialAudioForPeer(pid));
    }

    refreshNearbyPlayers() {
        const myId = this.socket?.id;
        const list = Object.entries(this.playerPositions)
            .filter(([id]) => id !== myId && this.peerConnections[id])
            .map(([id, p]) => ({id, username: p.username, distance: this.calculateDistanceToPeer(id)}))
            .filter((p) => p.distance < 30)
            .sort((a, b) => a.distance - b.distance);
        this.onPlayersUpdate(list);
    }

    calculateDistanceToPeer(id) {
        const me = this.playerPositions.me;
        const p = this.playerPositions[id];
        if (!me || !p || me.world !== p.world) return 999;
        const dx = me.x - p.x;
        const dy = me.y - p.y;
        const dz = me.z - p.z;
        return Math.hypot(dx, dy, dz);
    }

    toggleMute() {
        if (!this.localMicStream) return;
        const track = this.localMicStream.getAudioTracks()[0];
        if (track) track.enabled = !track.enabled;
    }

    setMicMuted(muted) {
        if (!this.localMicStream) return;
        const track = this.localMicStream.getAudioTracks()[0];
        if (track) track.enabled = !muted;
    }

    isMicMuted() {
        const track = this.localMicStream?.getAudioTracks?.()[0];
        return track ? !track.enabled : true;
    }

    setPlayerMuted(id, muted) {
        if (muted) this.mutedPlayerIds.add(id); else this.mutedPlayerIds.delete(id);
        const gain = this.peerConnections[id]?._nodes?.gain;
        if (gain) gain.gain.value = muted ? 0 : 1;
    }

    togglePlayerMute(id) {
        const next = !this.isPlayerMuted(id);
        this.setPlayerMuted(id, next);
        return next;
    }

    isPlayerMuted(id) {
        return this.mutedPlayerIds.has(id);
    }

    async setInputDevice(deviceId) {
        const baseAudioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            googNoiseSuppression: true,
            googEchoCancellation: true,
            googAutoGainControl: true,
            highpassFilter: true
        };

        const audioConstraints = !deviceId || deviceId === "default" ? baseAudioConstraints : {
            ...baseAudioConstraints,
            deviceId: {exact: deviceId}
        };

        const newStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraints});

        const newTrack = newStream.getAudioTracks()[0];
        if (!newTrack) {
            console.warn("No audio track found in new input device stream");
            return;
        }

        const oldStream = this.localMicStream;
        const oldTrack = oldStream?.getAudioTracks?.()[0];

        if (!this.localMicStream) {
            this.localMicStream = newStream;
        } else {
            if (oldTrack) {
                this.localMicStream.removeTrack?.(oldTrack);
            }
            this.localMicStream.addTrack?.(newTrack);
        }

        Object.values(this.peerConnections || {}).forEach(({pc}) => {
            try {
                const sender = pc.getSenders().find((s) => s.track && s.track.kind === "audio");

                if (sender) {
                    sender.replaceTrack(newTrack).catch((err) => {
                        console.warn("[VOICE] Track swap failed, falling back to addTrack()", err);
                        pc.addTrack?.(newTrack, this.localMicStream);
                    });
                } else {
                    pc.addTrack?.(newTrack, this.localMicStream);
                }
            } catch (e) {
                console.warn("Failed to update sender track for peer connection", e);
            }
        });

        if (oldTrack) {
            oldTrack.stop();
        }
    }

    async setOutputDevice(sinkId) {
        if (!this.outputAudioElement) throw new Error("Output audio element not initialized");
        const el = this.outputAudioElement;
        if (typeof el.setSinkId !== "function") throw new Error("setSinkId is not supported in this browser");
        await el.setSinkId(sinkId);
    }

    removePeerConnection(id) {
        const entry = this.peerConnections[id];
        if (!entry) return;

        if (entry._nodes) {
            entry._nodes?.source?.disconnect();
            entry._nodes?.panner?.disconnect();
            entry._nodes?.gain?.disconnect();
        }

        if (entry._peerAudioEl) {
            entry._peerAudioEl.pause?.();
            entry._peerAudioEl.srcObject = null;
            entry._peerAudioEl.remove?.();
            delete entry._peerAudioEl;
        }

        if (entry.pc) {
            entry.pc.onicecandidate = null;
            entry.pc.ontrack = null;
            entry.pc.close?.();
        }

        if (this.peerAnalysers[id]) {
            try { entry._nodes?.source?.disconnect?.(this.peerAnalysers[id]); } catch (_) {}
            delete this.peerAnalysers[id];
        }
        if (this.peerTimeData[id]) delete this.peerTimeData[id];

        delete this.peerConnections[id];
        delete this.playerPositions[id];

        this.refreshNearbyPlayers();
        this.stopLevelTickerIfIdle();
    }

    getActiveVoiceUsers() {
        if (!Array.isArray(this.presenceList)) return [];
        return this.presenceList.map((p) => ({id: p.id, username: p.username}));
    }

    disconnect() {
        if (this.positionTicker) {
            clearInterval(this.positionTicker);
            this.positionTicker = null;
        }

        if (this.socket) {
            this.socket.off?.("new-peer");
            this.socket.off?.("signal");
            this.socket.off?.("update-position");
            this.socket.off?.("remove-peer");
            this.socket.off?.("presence");
            this.socket.disconnect?.();
        }

        Object.keys(this.peerConnections).forEach((id) => this.removePeerConnection(id));
        this.peerConnections = {};

        if (this.localMicStream) {
            this.localMicStream.getTracks?.().forEach((t) => t.stop?.());
        }
        this.localMicStream = null;

        if (this.outputAudioElement) {
            this.outputAudioElement.pause?.();
            this.outputAudioElement.srcObject = null;
            this.outputAudioElement.remove?.();
        }
        this.outputAudioElement = null;
        this.outputDestination = null;
        this.masterGainNode = null;
        this.mutedPlayerIds = new Set();

        if (this.audioContext) {
            this.audioContext.close?.();
        }
        this.audioContext = null;

        if (this.levelTicker) {
            cancelAnimationFrame(this.levelTicker);
            this.levelTicker = null;
        }
        this.levelCallback = null;
        this.selfAnalyser = null;
        this.selfTimeData = null;
        this.peerAnalysers = {};
        this.peerTimeData = {};

        this.playerPositions = {};
        this.onPlayersUpdate?.([]);

        this.socket = null;
    }
}

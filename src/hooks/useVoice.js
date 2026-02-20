import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import ConnectedController from "../controllers/ConnectedController";

import connectSfx from "../assets/connect.mp3";
import muteSfx from "../assets/mute.mp3";
import unmuteSfx from "../assets/unmute.mp3";

export default function useVoice({token, username, skinUrl, onAlreadyConnected} = {}) {
    const [connected, setConnected] = useState(false);
    const [players, setPlayers] = useState([]);
    const [muted, setMuted] = useState(false);
    const [mics, setMics] = useState([]);
    const [speakers, setSpeakers] = useState([]);
    const [selectedMicId, setSelectedMicId] = useState("");
    const [selectedSpeakerId, setSelectedSpeakerId] = useState("");
    const [mutedIds, setMutedIds] = useState(() => new Set());
    const controllerRef = useRef(null);

    const [selfLevel, setSelfLevel] = useState(0);
    const [peerLevels, setPeerLevels] = useState({});
    const speakingThreshold = 0.22;
    const levelsDetachRef = useRef(null);

    const cueManagerRef = useRef(null);

    /**
     * lazy-load small UI sounds (connect / mute / unmute)
     * keeps one audio element per sound so we’re not recreating them every time
     */
    const getCueManager = useCallback(() => {
        if (!cueManagerRef.current) {
            const sounds = {};
            const loadCue = (type, src) => {
                if (!sounds[type]) {
                    const el = new Audio(src);
                    el.preload = "auto";
                    el.playsInline = true;
                    sounds[type] = el;
                }
                return sounds[type];
            };

            cueManagerRef.current = {
                play: async (type) => {
                    const map = {
                        connect: connectSfx, mute: muteSfx, unmute: unmuteSfx,
                    };
                    const el = loadCue(type, map[type]);
                    if (!el) return;
                    el.pause();
                    el.currentTime = 0;
                    try {
                        await el.play();
                    } catch (_) {
                    }
                }, setOutput: (deviceId) => {
                    Object.values(sounds).forEach((el) => {
                        if (el?.setSinkId) el.setSinkId(deviceId).catch(() => {
                        });
                    });
                }, cleanup: () => {
                    Object.values(sounds).forEach((el) => {
                        el.pause();
                        el.src = "";
                    });
                }
            };
        }
        return cueManagerRef.current;
    }, []);

    useEffect(() => {
        if (selectedSpeakerId) {
            getCueManager().setOutput(selectedSpeakerId);
        }
    }, [selectedSpeakerId, getCueManager]);

    /**
     * create the voice controller once and reuse it
     * avoids reconnect weirdness if the hook re-renders
     */
    const ensureController = () => {
        if (!controllerRef.current) {
            controllerRef.current = new ConnectedController(token, setPlayers);
        }
        return controllerRef.current;
    };

    /**
     * start voice connection and wire up mic + output device
     * also attaches level listeners after a successful join
     */
    const connect = async () => {
        const ctrl = ensureController();
        try {
            await ctrl.connect(selectedMicId);
        } catch (err) {
            if (err?.code === "ALREADY_CONNECTED" || err.message?.includes("Already connected")) {
                onAlreadyConnected?.();
                return;
            }
            console.error("Connect failed", err);
            return;
        }

        if (selectedSpeakerId) ctrl.setOutputDevice(selectedSpeakerId).catch(() => {
        });
        ctrl.setMicMuted?.(false);
        setMuted(ctrl.isMicMuted?.() || false);
        setConnected(true);

        await getCueManager().play("connect");

        levelsDetachRef.current?.();
        levelsDetachRef.current = ctrl.attachLevels?.(({self, peers}) => {
            setSelfLevel(self || 0);
            setPeerLevels(peers || {});
        });
    };

    /**
     * fully tear down the voice session and reset local state
     * safe to call even if things already partially failed
     */
    const disconnect = () => {
        try {
            controllerRef.current?.disconnect?.();
        } catch (e) {
            console.warn("Disconnect failed", e);
        } finally {
            setConnected(false);
            setMuted(false);
            setPlayers([]);
            setSelfLevel(0);
            setPeerLevels({});
            levelsDetachRef.current?.();
            levelsDetachRef.current = null;
        }
    };

    /**
     * toggle local mic state and play feedback sound
     * does nothing if user is not connected
     */
    const toggleMute = () => {
        if (!connected) return;
        const ctrl = controllerRef.current;
        if (!ctrl) return;
        ctrl.toggleMute();
        const nowMuted = ctrl.isMicMuted();
        setMuted(nowMuted);
        getCueManager().play(nowMuted ? "mute" : "unmute");
    };

    /**
     * initial device scan + listen for hardware changes
     * cleans everything up on unmount
     */
    useEffect(() => {
        const ctrl = ensureController();

        const refreshDevices = async () => {
            const {mics, speakers, defaultMicId, defaultSpeakerId} = await ctrl.enumerateDevices();
            setMics(mics);
            setSpeakers(speakers);
            if (!selectedMicId) setSelectedMicId(defaultMicId);
            if (!selectedSpeakerId) setSelectedSpeakerId(defaultSpeakerId);
        };

        refreshDevices();
        const detach = ctrl.attachDeviceChange(refreshDevices);

        return () => {
            detach?.();
            ctrl.disconnect?.();
            getCueManager().cleanup();
        };
    }, []);

    /**
     * switch input device on the fly
     * supports both raw id or select change event
     */
    const onSelectMic = async (idOrEvent) => {
        const id = typeof idOrEvent === "string" ? idOrEvent : idOrEvent.target.value;
        setSelectedMicId(id);
        if (connected) controllerRef.current?.setInputDevice(id).catch(console.error);
    };

    /**
     * switch output device for voice + UI sounds
     * will silently fail if browser doesn’t support setSinkId
     */
    const onSelectSpeaker = async (idOrEvent) => {
        const id = typeof idOrEvent === "string" ? idOrEvent : idOrEvent.target.value;
        setSelectedSpeakerId(id);
        if (connected) controllerRef.current?.setOutputDevice(id).catch(() => {
        });
    };

    /**
     * check if a specific player is muted locally
     * controller state takes priority over local fallback set
     */
    const isPlayerMuted = (id) => controllerRef.current?.isPlayerMuted?.(id) || mutedIds.has(id);

    /**
     * mute/unmute a specific remote player
     * only affects our local audio graph
     */
    const togglePlayerMute = (id) => {
        if (!connected) return;
        const next = controllerRef.current?.togglePlayerMute?.(id);
        setMutedIds((prev) => {
            const copy = new Set(prev);
            const nowMuted = typeof next === "boolean" ? next : !prev.has(id);
            nowMuted ? copy.add(id) : copy.delete(id);
            return copy;
        });
    };

    /**
     * resolve a safe username from props or controller
     * prevents undefined access during early renders
     */
    const safeUsername = useMemo(() => {
        try {
            return (username || controllerRef.current?.getSelfUsername?.() || "").trim();
        } catch {
            return "";
        }
    }, [username, players, connected]);

    /**
     * build mc-heads preview url for the player
     * falls back to default skin if username is missing
     */
    const finalSkin = useMemo(() => {
        return skinUrl || safeUsername ? `https://mc-heads.net/body/${encodeURIComponent(safeUsername)}/right` : "https://mc-heads.net/body/steve/right";
    }, [skinUrl, safeUsername]);

    return {
        connected, players, muted, mics, speakers, selectedMicId, selectedSpeakerId, mutedIds,

        connect, disconnect, toggleMute, onSelectMic, onSelectSpeaker, isPlayerMuted, togglePlayerMute,

        safeUsername, finalSkin,

        selfLevel, peerLevels, speakingThreshold,
    };
}

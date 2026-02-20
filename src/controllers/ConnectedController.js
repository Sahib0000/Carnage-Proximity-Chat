import VoiceManager from "../manager/VoiceManager";

export default class ConnectedController {
    constructor(token, onPlayersUpdate) {
        this.token = token;
        this.onPlayersUpdate = typeof onPlayersUpdate === "function" ? onPlayersUpdate : () => {
        };
        this.voice = null;
        this._deviceChangeHandler = null;
    }

    async connect(micId) {
        if (this.voice) return;
        const vm = new VoiceManager(this.token, this.onPlayersUpdate);
        const micIdForConnect = micId === "default" ? undefined : (micId || undefined);
        await vm.connect(micIdForConnect);
        this.voice = vm;
    }

    disconnect() {
        try {
            this.voice?.disconnect?.();
        } catch (_) {
        } finally {
            this.voice = null;
        }
    }

    toggleMute() {
        if (this.voice) this.voice.toggleMute();
    }

    setMicMuted(muted) {
        this.voice?.setMicMuted?.(muted);
    }

    isMicMuted() {
        return this.voice?.isMicMuted?.() ?? true;
    }

    togglePlayerMute(id) {
        return this.voice?.togglePlayerMute?.(id);
    }

    isPlayerMuted(id) {
        return this.voice?.isPlayerMuted?.(id) || false;
    }

    async setInputDevice(deviceId) {
        if (!this.voice) return;
        await this.voice.setInputDevice(deviceId);
    }

    async setOutputDevice(deviceId) {
        if (!this.voice) return;
        await this.voice.setOutputDevice(deviceId);
    }

    async enumerateDevices() {
        let permissionStream;
        try {
            if (!navigator.mediaDevices?.enumerateDevices) return {
                mics: [],
                speakers: [],
                defaultMicId: "",
                defaultSpeakerId: ""
            };
            try {
                permissionStream = await navigator.mediaDevices.getUserMedia({audio: true});
            } catch (_) {
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            const mics = devices.filter((d) => d.kind === "audioinput");
            const speakers = devices.filter((d) => d.kind === "audiooutput");
            const defaultMicId = mics.find((d) => d.deviceId === "default")?.deviceId || (mics[0]?.deviceId || "");
            const defaultSpeakerId = speakers.find((d) => d.deviceId === "default")?.deviceId || (speakers[0]?.deviceId || "");
            return {mics, speakers, defaultMicId, defaultSpeakerId};
        } finally {
            if (permissionStream) {
                try {
                    permissionStream.getTracks().forEach((t) => t.stop());
                } catch (_) {
                }
            }
        }
    }

    attachDeviceChange(callback) {
        if (!navigator.mediaDevices?.addEventListener) return () => {
        };
        this._deviceChangeHandler = () => callback?.();
        navigator.mediaDevices.addEventListener("devicechange", this._deviceChangeHandler);
        return () => this.detachDeviceChange();
    }

    detachDeviceChange() {
        if (this._deviceChangeHandler && navigator.mediaDevices?.removeEventListener) {
            try {
                navigator.mediaDevices.removeEventListener("devicechange", this._deviceChangeHandler);
            } catch (_) {
            }
        }
        this._deviceChangeHandler = null;
    }

    getSelfUsername() {
        try {
            return this.voice?.playerPositions?.me?.username || "";
        } catch (_) {
            return "";
        }
    }

    attachLevels(callback) {
        if (!this.voice) return () => {};
        return this.voice.attachLevels(callback);
    }
}

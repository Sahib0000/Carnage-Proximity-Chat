import React from "react";
import useVoice from "../hooks/useVoice";
import micSvg from "../assets/microphone.svg";

export default function ConnectedPage({token, username, skinUrl, onAlreadyConnected}) {
    const {
        connected,
        players,
        muted,
        mics,
        speakers,
        selectedMicId,
        selectedSpeakerId,
        connect,
        disconnect,
        toggleMute,
        onSelectMic,
        onSelectSpeaker,
        isPlayerMuted,
        togglePlayerMute,
        safeUsername,
        finalSkin,
        selfLevel,
        peerLevels,
        speakingThreshold,
    } = useVoice({token, username, skinUrl, onAlreadyConnected});

    return (<div className="page">
        <p className="warning-top">Keep this tab focused/open to avoid connection issues!</p>

        <div className="card">
            <div className="player-bg">
                <div className="player-display">
                    <img src={finalSkin} alt={safeUsername || "steve"}/>
                    <div className="nametag">
                        <span>{safeUsername || "???"}</span>
                    </div>
                </div>
                <div className={`vu vu-self ${selfLevel > speakingThreshold ? "speaking" : ""}`} aria-hidden="true">
                    <div className="vu-bar"
                         style={{width: `${Math.min(100, Math.max(0, Math.round(selfLevel * 140)))}%`}}/>
                </div>
            </div>

            <div className="content">
                <div className="voice-controls">
                    <h1 className="logo">CARNAGE</h1>

                    <select className="device-select" value={selectedMicId} onChange={onSelectMic}>
                        {mics.length === 0 ? (<option value="">Microphone: No devices</option>) : (mics.map((d) => (
                            <option key={d.deviceId || d.label} value={d.deviceId}>
                                {d.label || "Microphone"}
                            </option>)))}
                    </select>

                    <select className="device-select" value={selectedSpeakerId} onChange={onSelectSpeaker}>
                        {speakers.length === 0 ? (
                            <option value="">Speakers: System Default</option>) : (speakers.map((d) => (
                            <option key={d.deviceId || d.label} value={d.deviceId}>
                                {d.label || "Speakers"}
                            </option>)))}
                    </select>
                    <div className="action-row">
                        <button
                            className={`mute-btn ${muted ? "muted" : ""}`}
                            onClick={toggleMute}
                            disabled={!connected}
                            aria-disabled={!connected}
                            aria-label={!connected ? "Connect to voice to use mute" : (muted ? "Muted" : "Unmuted")}
                            title={!connected ? "Connect to voice to use mute" : (muted ? "Muted" : "Unmuted")}
                        >
                            {muted ? (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="1" y1="1" x2="23" y2="23"/>
                                <path d="M9 9V4a3 3 0 0 1 6 0v6"/>
                                <path d="M19 11a7 7 0 0 1-7 7"/>
                                <path d="M5 11a7 7 0 0 0 10.39 5.61"/>
                                <line x1="12" y1="19" x2="12" y2="23"/>
                                <line x1="8" y1="23" x2="16" y2="23"/>
                            </svg>) : (<img src={micSvg} alt="" aria-hidden="true" className="mic-icon"/>)}
                        </button>

                        {!connected ? (<button className="connect-btn" onClick={connect}>
                            CONNECT TO VOICE
                        </button>) : (<button className="disconnect-btn" onClick={disconnect}>
                            DISCONNECT
                        </button>)}
                    </div>
                </div>
            </div>
        </div>

        <aside className="players-side" aria-live="polite">
            <div className="players-panel-header">NEARBY PLAYERS</div>
            <div className="players-panel-body">
                {players.length === 0 ? (<div className="players-empty">No players nearby</div>) : (
                    <ul className="players-list">
                        {players.map((p) => {
                            const head = `https://mc-heads.net/avatar/${encodeURIComponent(p.username || "Steve")}/32`;
                            const mutedOne = isPlayerMuted(p.id);
                            const lvl = peerLevels?.[p.id] || 0;
                            return (<li key={p.id} className="players-item">
                                <div className="player-meta">
                                    <img className="player-head" src={head} alt="" aria-hidden="true"/>
                                    <div className="player-names">
                                        <span className="player-ign">{p.username || "???"}</span>
                                        {typeof p.distance === "number" && (
                                            <span className="player-dist">{p.distance.toFixed(1)}m</span>)}
                                    </div>
                                </div>
                                <div className={`vu vu-peer ${lvl > speakingThreshold ? "speaking" : ""}`}
                                     aria-label={`Level for ${p.username || "player"}`}>
                                    <div className="vu-bar"
                                         style={{width: `${Math.min(100, Math.max(0, Math.round(lvl * 140)))}%`}}/>
                                </div>
                                <button
                                    type="button"
                                    className={`player-mute ${mutedOne ? "muted" : ""}`}
                                    onClick={() => togglePlayerMute(p.id)}
                                    disabled={!connected}
                                    aria-disabled={!connected}
                                    aria-label={!connected ? `Connect to voice to mute ${p.username || "player"}` : (mutedOne ? `Unmute ${p.username || "player"}` : `Mute ${p.username || "player"}`)}
                                    aria-pressed={mutedOne}
                                    title={!connected ? "Connect to voice to use mute" : (mutedOne ? "Muted" : "Unmuted")}
                                >
                                    {mutedOne ? (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                      strokeWidth="2" strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      aria-hidden="true">
                                        <line x1="1" y1="1" x2="23" y2="23"/>
                                        <path d="M9 9V4a3 3 0 0 1 6 0v6"/>
                                        <path d="M19 11a7 7 0 0 1-7 7"/>
                                        <path d="M5 11a7 7 0 0 0 10.39 5.61"/>
                                        <line x1="12" y1="19" x2="12" y2="23"/>
                                        <line x1="8" y1="23" x2="16" y2="23"/>
                                    </svg>) : (<img src={micSvg} alt="" aria-hidden="true" className="mic-icon"/>)}
                                </button>
                            </li>);
                        })}
                    </ul>)}
            </div>
        </aside>

        <p className="warning-bottom">Make sure to Alt-Tab to avoid minimizing the window!</p>
    </div>);
}
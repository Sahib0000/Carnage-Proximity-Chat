import React from "react";

export default function AlreadyConnectedPage() {
    const goBack = () => {
        try {
            const {origin, pathname} = window.location;
            window.location.href = origin + pathname;
        } catch (_) {
        }
    };

    const tryAgain = () => {
        try {
            window.location.reload();
        } catch (_) {
        }
    };

    return (<div className="page">
            <div className="card">
                <div className="player-bg">
                    <div className="player-display">
                        <img
                            src="https://mc-heads.net/body/steve/right"
                            alt="Steve"
                        />
                        <div className="nametag">
                            <span>???</span>
                        </div>
                    </div>
                </div>

                <div className="content">
                    <div className="voice-controls">
                        <h1 className="logo">CARNAGE</h1>
                        <div className="no-login-block" style={{textAlign: "center"}}>
                            <p style={{fontWeight: 700, fontSize: "1.25rem", marginBottom: 12}}>
                                You are already connected to voice in another window or device.
                            </p>
                            <p style={{opacity: 0.9}}>
                                If you believe this is an issue, please contact staff.
                            </p>
                        </div>
                        <div className="action-row">
                            <button className="disconnect-btn" onClick={goBack}>
                                GO BACK
                            </button>
                            <button className="connect-btn" onClick={tryAgain}>
                                TRY AGAIN
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>);
}

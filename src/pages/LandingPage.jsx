import React from "react";

export default function LandingPage() {
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
                    <div className="no-login-block">
                        <p>
                            Join <b>play.carnagepvp.net</b> and run the following command on a supported server:
                        </p>

                        <div className="no-login-command">
                            <p>/voice</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>);
}
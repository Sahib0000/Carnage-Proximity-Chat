import LandingPage from "./pages/LandingPage";
import ConnectedPage from "./pages/ConnectedPage";
import AlreadyConnectedPage from "./pages/AlreadyConnectedPage";
import "./style.css";

import React, {useCallback, useEffect, useState} from "react";

export default function App() {
    const search = new URLSearchParams(window.location.search);
    const urlToken = search.get("code");
    const urlUsername = search.get("u") || "";

    const [token, setToken] = useState(() => urlToken || "");
    const [username, setUsername] = useState(() => urlUsername || "");
    const [alreadyConnected, setAlreadyConnected] = useState(false);

    useEffect(() => {
        if (!urlToken) return;

        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("u");
        window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);

        setToken(urlToken);
        if (urlUsername) setUsername(urlUsername);
    }, [urlToken, urlUsername]);

    useEffect(() => {
        if (token || !username) return;

        let aborted = false;

        (async () => {
            try {
                const res = await fetch("/active");
                const data = await res.json().catch(() => ({}));
                const list = Array.isArray(data?.active) ? data.active : [];
                if (!aborted && list.some((p) => p?.username === username)) {
                    setAlreadyConnected(true);
                }
            } catch {
            }
        })();

        return () => {
            aborted = true;
        };
    }, [token, username]);

    const handleAlreadyConnected = useCallback(() => {
        setAlreadyConnected(true);
    }, []);

    // for testing
    // return <ConnectedPage token="test" username="xadia" />;

    // for normal
    if (!token) return <LandingPage/>;
    if (alreadyConnected) return <AlreadyConnectedPage/>;
    return <ConnectedPage token={token} username={username} onAlreadyConnected={handleAlreadyConnected}/>;
}

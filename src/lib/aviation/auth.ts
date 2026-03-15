import { globalState } from "./state";

export async function getOpenSkyAccessToken() {
    const now = Date.now();
    if (globalState.accessToken && now < globalState.tokenExpiry) {
        return globalState.accessToken;
    }

    const clientId = process.env.OPENSKY_CLIENTID;
    const clientSecret = process.env.OPENSKY_CLIENTSECRET;

    if (!clientId || !clientSecret) return null;

    if (!clientId.includes("@") && !clientId.endsWith("-api-client")) {
        return null;
    }

    try {
        const response = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId,
                client_secret: clientSecret,
            }),
            cache: "no-store",
        });

        if (!response.ok) {
            console.error(`[Aviation Polling] OAuth token error (${response.status}):`, await response.text());
            return null;
        }

        const data = await response.json();
        globalState.accessToken = data.access_token;
        globalState.tokenExpiry = now + (data.expires_in * 1000) - 30000;

        console.log("[Aviation Polling] Successfully acquired new OpenSky OAuth token");
        return globalState.accessToken;
    } catch (error) {
        console.error("[Aviation Polling] OAuth token request failed:", error);
        return null;
    }
}

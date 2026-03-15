import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
        return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
    }

    try {
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "WorldWideView/1.0",
                "Accept": "application/json, text/plain, */*"
            }
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Failed to fetch from target URL (Status: ${response.status})` },
                { status: response.status }
            );
        }

        // Try to parse the response as JSON directly first. 
        // If the server returns a downloaded file (like camlist.net), 
        // fetch() will still read the stream if we call .text() or .json()
        const text = await response.text();

        try {
            const data = JSON.parse(text);
            return NextResponse.json(data);
        } catch (parseError) {
            console.error("[CameraProxy] Failed to parse target response as JSON:", parseError);
            return NextResponse.json(
                { error: "Target URL did not return a valid JSON format." },
                { status: 502 }
            );
        }
    } catch (error: any) {
        console.error("[CameraProxy] Error fetching target URL:", error);
        return NextResponse.json(
            { error: "Failed to proxy request", details: error.message },
            { status: 500 }
        );
    }
}

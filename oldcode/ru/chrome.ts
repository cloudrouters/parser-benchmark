
import { execFile as execFileCallback } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";


import type { RuPageSnapshot } from "./services";


const execFile = promisify(execFileCallback);


const CHROME_PATH =
 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";


const PROFILE_DIRECTORY = "Profile 261";
const POLL_INTERVAL_MS = 250;
const START_TIMEOUT_MS = 30_000;


let chromeProcess: ChildProcess | null = null;


function sleep(milliseconds: number): Promise<void> {
 return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


async function runAppleScript(script: string): Promise<string> {
 const { stdout } = await execFile("osascript", ["-e", script], {
   timeout: 10_000,
   maxBuffer: 2 * 1024 * 1024,
 });


 return stdout.trim();
}


async function executeJavaScript(script: string): Promise<string> {
 const encodedScript = Buffer.from(script, "utf8").toString("base64");


 const appleScript =
   'tell application "Google Chrome" to execute active tab of ' +
   `front window javascript "eval(atob('${encodedScript}'))"`;


 return runAppleScript(appleScript);
}


export async function stopChrome(): Promise<void> {
 try {
   await runAppleScript('tell application "Google Chrome" to quit');
 } catch {
   // Chrome may not be running.
 }


 const deadline = Date.now() + 15_000;


 while (Date.now() < deadline) {
   try {
     await execFile("pgrep", ["-x", "Google Chrome"]);
     await sleep(POLL_INTERVAL_MS);
   } catch {
     chromeProcess = null;
     return;
   }
 }


 if (chromeProcess !== null && chromeProcess.exitCode === null) {
   chromeProcess.kill("SIGTERM");
 }


 chromeProcess = null;


 throw new Error(
   "Chrome did not shut down within 15 seconds. Close it manually and retry."
 );
}


export async function startChrome(
 startUrl: string,
 localPort: string | null
): Promise<void> {
 await stopChrome();


 const args = [
   `--profile-directory=${PROFILE_DIRECTORY}`,
   "--no-first-run",
   "--no-default-browser-check",
 ];


 if (localPort !== null) {
   args.push(`--proxy-server=http://127.0.0.1:${localPort}`);
 }


 args.push(startUrl);


 chromeProcess = spawn(CHROME_PATH, args, {
   detached: true,
   stdio: "ignore",
 });


 chromeProcess.unref();


 const deadline = Date.now() + START_TIMEOUT_MS;


 while (Date.now() < deadline) {
   try {
     const snapshot = await readPageSnapshot();


     if (snapshot.url.startsWith("http")) {
       return;
     }
   } catch {
     // Chrome may still be starting.
   }


   await sleep(POLL_INTERVAL_MS);
 }


 throw new Error("Chrome did not open a page within 30 seconds.");
}


export async function navigateChrome(url: string): Promise<void> {
 const encodedUrl = Buffer.from(url, "utf8").toString("base64");


 await runAppleScript(
   'tell application "Google Chrome" to set URL of active tab of ' +
     `front window to (do shell script "printf %s ${encodedUrl} | ` +
     'base64 -d")'
 );
}


export async function navigateChromeToBlank(): Promise<void> {
 await navigateChrome("about:blank");


 const deadline = Date.now() + 10_000;


 while (Date.now() < deadline) {
   try {
     const snapshot = await readPageSnapshot();


     if (snapshot.url === "about:blank") {
       return;
     }
   } catch {
     // Wait for the blank page.
   }


   await sleep(POLL_INTERVAL_MS);
 }


 throw new Error("Chrome did not navigate to about:blank.");
}


export async function readPageSnapshot(): Promise<RuPageSnapshot> {
 const script = `JSON.stringify((() => {
   const navigation = performance.getEntriesByType("navigation")[0];
   const html = document.documentElement;
   const body = document.body;


   return {
     url: location.href,
     title: document.title || "",
     body: body ? body.innerText : "",
     status: navigation && navigation.responseStatus
       ? navigation.responseStatus
       : null,
     readyState: document.readyState,
     htmlLength: html ? html.outerHTML.length : 0,
     productLinks: document.querySelectorAll('a[href*="/catalog/"]').length,
     images: document.images.length
   };
 })())`;


 const raw = await executeJavaScript(script);


 let parsed: unknown;


 try {
   parsed = JSON.parse(raw);
 } catch {
   throw new Error("Could not parse Chrome page information.");
 }


 if (typeof parsed !== "object" || parsed === null) {
   throw new Error("Chrome returned invalid page information.");
 }


 const value = parsed as Record<string, unknown>;


 return {
   url: typeof value.url === "string" ? value.url : "",
   title: typeof value.title === "string" ? value.title : "",
   body: typeof value.body === "string" ? value.body : "",
   status:
     typeof value.status === "number" && value.status > 0
       ? value.status
       : null,
   readyState: typeof value.readyState === "string" ? value.readyState : "",
   htmlLength: typeof value.htmlLength === "number" ? value.htmlLength : 0,
   productLinks:
     typeof value.productLinks === "number" ? value.productLinks : 0,
   images: typeof value.images === "number" ? value.images : 0,
 };
}


export async function waitForNavigation(
 expectedUrl: string,
 timeoutMs: number
): Promise<RuPageSnapshot> {
 const deadline = Date.now() + timeoutMs;


 while (Date.now() < deadline) {
   const snapshot = await readPageSnapshot();


   if (
     snapshot.url.startsWith(expectedUrl) &&
     snapshot.status !== null &&
     snapshot.readyState !== "loading"
   ) {
     return snapshot;
   }


   await sleep(POLL_INTERVAL_MS);
 }


 return readPageSnapshot();
}

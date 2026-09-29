# Parser Benchmark

A tool for testing the suitability of a SOCKS5 connection for parsing tasks and comparing the performance of a SOCKS5 connection with a direct Internet connection.

## How the Parsing Test Works

For each website, the program:

1. Opens the website in Chromium;

2. Checks the HTTP response;

3. Checks for the expected content;

4. Detects whether a CAPTCHA is present;

5. If a CAPTCHA is detected, waits for it to be completed automatically;

6. Saves the result;

7. Proceeds to the next attempt.

Before the test starts, the program checks the external IP address through `api.ipify.org`.

By default, each attempt is performed in a new browser context.

With `--reuse-context`, a single browser context is used for all attempts for the same website.

## Installation

1. Download the repository: **Code / Download ZIP**

2. Extract the archive.

3. Download and install Node.js:

https://nodejs.org/en/download

4. Open the repository directory in CMD, PowerShell, Terminal, or another terminal.

5. Install the project dependencies:

```bash
npm install
```

6. Install the Chromium browser required by Playwright:

```bash
npx playwright install chromium
```

The same installation commands are used on Windows and macOS.

Google Chrome does not need to be installed separately. Playwright uses its own Chromium browser.

## Quick Start

To establish a reference baseline using a direct Internet connection:

```bash
npm run parser
```

To run the test through SOCKS5:

```bash
npm run parser -- "socks5://login:pass@ip:port"
```

By default, 10 attempts are performed for each website.

## Example Output

<pre>

Mode: socks5://login:***@ip:port

Attempts: 10

Context mode: NEW PER ATTEMPT

Starting local proxy bridge...

Local HTTP proxy: 127.0.0.1:12345

Checking connection through SOCKS5...

External IP: 188.28.90.112

Internet connection: <span style="color:#32CD32">OK</span>

<b>Google</b>

Attempt 1/10 Request: <span style="color:#32CD32">OK</span> | Challenge: <span style="color:#32CD32">No</span> | Content: <span style="color:#32CD32">OK</span> | Response time: 842 ms | HTTP status: <span style="color:#32CD32">200</span>

</pre>

## Parameters

General command format:

```bash
npm run parser -- [SOCKS5] [OPTIONS]
```

Each website is tested 10 times.

### SOCKS5

A local HTTP proxy bridge is automatically created for Chromium and forwards traffic through the specified SOCKS5 connection.

```bash
npm run parser -- "socks5://login:pass@ip:port"
```

### `--reuse-context`

By default, a new browser context is created for each attempt.

To reuse a single context for all attempts for each website:

```bash
npm run parser -- "socks5://login:pass@ip:port" --reuse-context
```

After the website test is completed, the context is closed and a new context is created for the next website.

## Tested Websites

The current version tests:

| **Website** | **URL**                  |
| ----------- | ------------------------ |
| Google      | https://www.google.com   |
| Bing        | https://www.bing.com     |
| Amazon      | https://www.amazon.com   |
| eBay        | https://www.ebay.com     |
| Walmart     | https://www.walmart.com  |
| Booking     | https://www.booking.com  |
| LinkedIn    | https://www.linkedin.com |

Each website is tested 10 times.

## Connection Check

Before the test starts, the program retrieves the external IP address through:

```text
https://api.ipify.org/?format=json
```

In SOCKS5 mode, the request is performed through the SOCKS5 connection.

If the external IP address cannot be retrieved, the test is terminated.

## Request Check

A request is considered successful if the HTTP status is within the `200–399` range.

For example:

```text
Request: OK

HTTP status: 200
```

If navigation fails or another HTTP status is returned:

```text
Request: FAIL
```

## Content Check

After a successful request, the program checks the page content.

| **Website** | **Expected Content** |
| ----------- | -------------------- |
| Google      | Google               |
| Bing        | Bing                 |
| Amazon      | Amazon               |
| eBay        | eBay                 |
| Walmart     | Walmart              |
| Booking     | Booking.com          |
| LinkedIn    | LinkedIn             |

If the expected content is found:

```text
Content: OK
```

If it is not found:

```text
Content: FAIL
```

The content check runs for up to 5 seconds.

## Challenge

The program detects CAPTCHA challenges based on the following indicators:

```text
just a moment

checking your browser

verify you are human

verify you are a human

unusual traffic

access denied

security check

captcha

recaptcha

hcaptcha

cf-chl-

cloudflare

akamai

bot manager

are you a robot
```

A detected CAPTCHA does not immediately terminate the attempt.

The program waits for up to 30 seconds for the challenge to disappear automatically.

If the challenge disappears and the expected content appears:

```text
Request: OK

Challenge: YES

Content: OK
```

The challenge is still included in the statistics.

If the challenge remains after 30 seconds:

```text
Request: OK

Challenge: YES

Content: FAIL
```

The expected content is not considered successful while the challenge is present.

This is especially important for eBay, because the challenge page itself may contain the word `eBay`.

If the eBay challenge remains after the waiting period, the program additionally outputs the URL, title, part of the page content, and saves a screenshot:

```text
ebay-challenge-N.png
```

## Statistics

After all attempts are completed, the program displays the statistics.

### Statistics after 10 attempts

| **Target** | **Requests** | **Request** | **Content** | **Content** | **Challenge** | **Challenge** |
| ---------- | -----------: | ----------: | ----------: | ----------: | ------------: | ------------: |
| Google     |        10/10 |        100% |       10/10 |        100% |          0/10 |            0% |
| Bing       |        10/10 |        100% |       10/10 |        100% |          0/10 |            0% |

**Requests** — number of attempts with a successful HTTP request.

**Request** — percentage of successful HTTP requests.

**Content** — number of attempts in which the expected content was found.

**Content** — percentage of attempts in which the expected content was found.

**Challenge** — number of attempts in which a challenge was detected.

**Challenge** — percentage of attempts in which a challenge was detected.

Automatically completed challenges are also included in the statistics.

### Response Time

| **Target** | **AVG** | **P50** | **P90** | **P95** | **P99** |
| ---------- | ------: | ------: | ------: | ------: | ------: |
| Google     |  821 ms |  810 ms |  941 ms |  967 ms |  982 ms |

**AVG** — average execution time of an attempt.

**P50 / P90 / P95 / P99** — percentile distribution of attempt execution times.

If a challenge is detected during an attempt, the time spent waiting for it is included in the Response Time.

## Saving Results

After the test is completed, the results are saved to:

```text
benchmark-results.json
```

The file contains:

* test mode;

* SOCKS5;

* external IP address;

* number of attempts;

* browser context mode;

* test start time;

* results of each attempt;

* response time statistics.

Example:

```json
{
  "mode": "SOCKS5",
  "proxy": "socks5://login:***@ip:port",
  "externalIP": "188.28.90.112",
  "attempts": 10,
  "contextMode": "NEW_PER_ATTEMPT",
  "generatedAt": "2026-09-28T19:00:00.000Z"
}
```

The password is never stored in plain text.

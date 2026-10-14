# Parser Benchmark

A tool for testing the suitability of a SOCKS5 connection for parsing tasks and comparing the performance of a SOCKS5 connection with a direct Internet connection.

## How the Parsing Test Works

For each website, the program:

1. Opens the website in the selected browser (Chromium by default, or Google Chrome with `--browser=chrome`);

2. Checks the HTTP response;

3. Checks for the expected content;

4. Detects whether a CAPTCHA is present;

5. If a CAPTCHA is detected, waits for it to be completed automatically;

6. Saves the result;

7. Proceeds to the next attempt.

Before the test starts, the program checks the external IP address through `api.ipify.org`.

By default, each attempt is performed in a new browser context.

With `--reuse-context`, a single browser context is used for all attempts for the same website. With `--browser=chrome`, every attempt is still a restarted Chrome, but on the same profile, so its storage is kept.

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

Google Chrome does not need to be installed for the default mode. Playwright uses its own Chromium browser. Google Chrome is required only with `--browser=chrome`.

## Quick Start

To establish a reference baseline using a direct Internet connection:

```bash
npm run parser
```

To run the test through SOCKS5:

```bash
npm run parser -- "socks5://login:pass@ip:port"
```

To test the Russian websites (Avito, Wildberries, Ozon, Yandex, and others) in a real Google Chrome:

```bash
npm run parser -- --targets=ru --browser=chrome
npm run parser -- "socks5://login:pass@ip:port" --targets=ru --browser=chrome
```

By default, 10 attempts are performed for each website.

## Example Output

<pre>

Mode: socks5://login:***@ip:port

Attempts: 10

Context mode: NEW PER ATTEMPT

Browser: chromium

Targets: global

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

A local HTTP proxy bridge is automatically created for the browser (Chromium or Chrome) and forwards traffic through the specified SOCKS5 connection.

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

### `--browser`

Selects the browser used for the test. The default is `chromium`.

| **Value**  | **Browser**                                         |
| ---------- | --------------------------------------------------- |
| `chromium` | Chromium bundled with Playwright (default)          |
| `chrome`   | Installed Google Chrome (started as a real browser) |

```bash
npm run parser -- "socks5://login:pass@ip:port" --browser=chrome
```

`--browser=chrome` requires an installed Google Chrome. It works the same way on macOS and Windows.

The program looks for Chrome in the standard installation directories. To use another Chrome executable, set the `CHROME_PATH` environment variable:

```bash
CHROME_PATH="/path/to/chrome" npm run parser -- --browser=chrome
```

On Windows PowerShell:

```powershell
$env:CHROME_PATH = "C:\path\to\chrome.exe"; npm run parser -- --browser=chrome
```

In this mode the program starts a real Chrome window and controls it over the DevTools protocol. Your own Chrome profile, cookies and open windows are never used or closed:

* every browser context has its own **new temporary profile** (a `parser-benchmark-chrome-*` directory in the system temporary folder);
* every attempt starts a new Chrome process on the profile of its context, opens the website in its first (and only) tab, checks the result, and then quits the whole Chrome;
* by default (a new context per attempt) the profile is deleted together with Chrome, so the website sees a new visitor every time;
* with `--reuse-context`, the profile is kept for all attempts for the same website, so every attempt is a restarted Chrome that still has the cookies and storage of the previous attempt (for example a passed captcha). The profile is deleted after the website is tested;
* Chrome uses the language, time zone and screen settings of your computer. They are not emulated.

### `--targets`

Selects the set of websites to test. The default is `global`.

| **Value** | **Websites**                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `global`  | Google, Bing, Amazon, eBay, Walmart, Booking, LinkedIn (default)                |
| `ru`      | Avito, Wildberries, Ozon, Yandex, Yandex Market, Yandex Zen, Cian, HH, Drom, VK |

```bash
npm run parser -- --targets=global
npm run parser -- "socks5://login:pass@ip:port" --targets=ru
```

The `--` after the script name is required: without it npm treats `--targets` as its own option and does not pass it to the program.

An unknown browser, an unknown set, or an unknown option stops the program with an error that lists the available values.

## Tested Websites

The `global` set (`--targets=global`, the default) tests:

| **Website** | **URL**                  |
| ----------- | ------------------------ |
| Google      | https://www.google.com   |
| Bing        | https://www.bing.com     |
| Amazon      | https://www.amazon.com   |
| eBay        | https://www.ebay.com     |
| Walmart     | https://www.walmart.com  |
| Booking     | https://www.booking.com  |
| LinkedIn    | https://www.linkedin.com |

The `ru` set (`--targets=ru`) tests:

| **Website**   | **URL**                    |
| ------------- | -------------------------- |
| Avito         | https://www.avito.ru       |
| Wildberries   | https://www.wildberries.ru |
| Ozon          | https://www.ozon.ru        |
| Yandex        | https://ya.ru              |
| Yandex Market | https://market.yandex.ru   |
| Yandex Zen    | https://dzen.ru            |
| Cian          | https://www.cian.ru        |
| HH            | https://hh.ru              |
| Drom          | https://www.drom.ru        |
| VK            | https://vk.com             |

Wildberries checks the browser before showing the website. Use `--browser=chrome` for it: the bundled Chromium is usually not allowed through the check. We recommend `--browser=chrome` for the whole `ru` set.

Challenge diagnostics are enabled for every `ru` website (see [Challenge](#challenge)).

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

| **Website**   | **Expected Content** |
| ------------- | -------------------- |
| Google        | Google               |
| Bing          | Bing                 |
| Amazon        | Amazon               |
| eBay          | eBay                 |
| Walmart       | Walmart              |
| Booking       | Booking.com          |
| LinkedIn      | LinkedIn             |
| Avito         | Авито                |
| Wildberries   | Wildberries          |
| Ozon          | Ozon                 |
| Yandex        | Яндекс               |
| Yandex Market | Яндекс Маркет        |
| Yandex Zen    | Дзен                 |
| Cian          | ЦИАН                 |
| HH            | hh.ru                |
| Drom          | Дром                 |
| VK            | VK                   |

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

проверяем браузер

подозрительная активность

подозрительную активность

доступ ограничен
```

A detected CAPTCHA does not immediately terminate the attempt.

The program waits for up to 30 seconds for the challenge to disappear automatically.

If the challenge disappears and the expected content appears:

```text
Request: OK

Challenge: AUTO

Content: OK
```

`AUTO` (yellow) means that a challenge appeared and was passed automatically. The challenge is still included in the statistics.

`MANUAL` (cyan) means that a challenge appeared and a person passed it, for example by solving a captcha. The program recognises it by the person's input (mouse, touch or keyboard events that scripts of a page cannot fake) in the page during the attempt. It is available with `--browser=chrome` only, and an attempt with a challenge but without such input stays `AUTO`.

If the challenge remains after 30 seconds:

```text
Request: OK

Challenge: YES

Content: FAIL
```

`YES` (red) means that the challenge was not passed. Without a challenge the value is `No` (green).

The expected content is not considered successful while the challenge is present.

This is especially important for eBay, because the challenge page itself may contain the word `eBay`.

If the eBay challenge remains after the waiting period, the program additionally outputs the URL, title, part of the page content, and saves a screenshot:

```text
ebay-challenge-N.png
```

The same diagnostics are saved for every `ru` website, for example `wildberries-challenge-N.png`. They are meant for analysing captchas and antibot pages of these websites before adding their handling.

### Challenge status codes

Wildberries first answers with HTTP status `498` and a stub page ("Проверяем браузер", then "Подозрительная активность" if the check fails). If the browser passes the check, the page reloads with the real website.

Avito (Qrator antibot) answers with `439` for its check page and `429` for its "Доступ ограничен: проблема с IP" page. The check page usually passes by itself within a second and the real website loads. After that, or instead of it, Avito may ask for a captcha that has to be solved by hand, either as a separate page or as a dialog on top of the already visible website. The dialog appears several seconds after the content, so for such targets content is accepted at once only when the page has fully loaded (`document.readyState` is `complete`) and no challenge text is present. A page that never reports `complete` (Avito through a proxy) is observed until the end of the window instead, and is accepted if the challenge text did not show up.

Ozon (antibot) answers a new profile with HTTP status `403` and a check page titled "Antibot Challenge Page" that has no text. The page runs its check in the background and reloads itself into the real website after a few seconds. A profile that has passed the check once gets the website at once, so the check shows up only in the first attempt with a new profile (or without `--reuse-context`, in every attempt).

Such a status is declared per website. At the moment Ozon (`403`), Wildberries (`498`) and Avito (`439`, `429`) declare one. The other `ru` websites have no special handling: if one of them shows a captcha or an antibot page, the attempt is reported as `Challenge: YES` (or `FAIL` for a non-`2xx`/`3xx` status) and the diagnostics are saved, so the stub can be analysed and its handling added.

For targets that declare such a status, the response is treated as a delivered request:

```text
Request: OK | Challenge: AUTO | Content: OK | HTTP status: 200
```

The program then waits up to 30 seconds for the stub to be replaced with the real content. When the challenge disappears, the page gets a fresh window to load, so the time a person needed to solve a captcha is not taken from it. Content is accepted only when the page itself reports a status other than the declared ones (for example `498`), so the stub can never be counted as content. When the content arrives, the report shows the status of the page that delivered it (for example `200`) instead of the original `498`.

If the stub does not go away, the attempt is reported as `Challenge: YES | Content: FAIL` and keeps the original status, for example `498` or `439` (shown in yellow, because the request itself was delivered).

The program does not solve captchas. A captcha that needs manual solving is a measurement result: the connection and the browser profile are treated by the website as suspicious. Without `--reuse-context` every attempt uses a new temporary profile, so the website sees a new visitor each time. With `--reuse-context` and `--browser=chrome` you can solve the captcha by hand once: Chrome is restarted for the next attempt on the same profile, and the stored pass can stop the captcha from appearing again. Whether it does depends on the website (a pass kept only until the browser closes is lost on restart). Solving the captcha in your own Chrome profile does not help the benchmark.

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

## Limitations

* With `--browser=chrome`, stopping the program with `Ctrl+C` does not delete the temporary Chrome profile, and the Chrome window it started may stay open. Close the window if needed and remove the leftover `parser-benchmark-chrome-*` directories from the system temporary folder manually.
* Only Ozon (`403`), Wildberries (`498`) and Avito (`439`, `429`) have dedicated challenge statuses. Captchas of the other `ru` websites are only detected by the generic indicators listed above.
* In our test runs from one direct connection Avito showed a captcha that has to be solved by hand in every attempt with a new profile. Other connections may behave differently. An unsolved captcha is reported as `Challenge: YES`; a captcha solved by hand is reported as `Challenge: MANUAL`.
* `Challenge: MANUAL` is available with `--browser=chrome` only. With Chromium launched by Playwright a challenge passed by a person is reported as `AUTO`.
* A Chrome that has to be killed instead of quitting normally may lose the cookies it had not written to the profile yet.
* The expected content of the `ru` websites is a simple text match on the page title or body. If a website changes its wording, update `src/targets/ru.ts`.

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

* browser (`browser`) and target set (`targetSet`);

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
  "browser": "chromium",
  "targetSet": "global",
  "generatedAt": "2026-09-28T19:00:00.000Z"
}
```

The password is never stored in plain text.

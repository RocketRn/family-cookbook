# Content-Security-Policy (CSP)

PRD 7.1 asks for a CSP. A CSP tells the browser which addresses the app may load scripts, images, frames and data from, so injected content cannot load anything else. Ours ships in two phases (D-032):

1. **Report-Only (now).** The production build sends `Content-Security-Policy-Report-Only`. Nothing is blocked; every would-be violation is reported to the API and logged.
2. **Enforcing (after the first real Telegram test).** When the reports show no legitimate violations on iPhone, Android, Telegram Desktop and Telegram Web, the same policy is sent as `Content-Security-Policy`.

## The policy

Built by `apps/web/csp.ts` from the build environment:

| Variable              | Default                            | What it is                                                          |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `CSP_API_ORIGIN`      | same site (`/api`)                 | API origin when the API is on another address                       |
| `CSP_S3_ORIGIN`       | none                               | origin of photo links (the API's `S3_PUBLIC_ENDPOINT`). **Set it.** |
| `CSP_TELEGRAM_ORIGIN` | `https://telegram.org`             | Telegram's official Mini App script                                 |
| `CSP_YOUTUBE_ORIGIN`  | `https://www.youtube-nocookie.com` | the embedded video player                                           |
| `CSP_FRAME_ANCESTORS` | `'self' https://web.telegram.org`  | who may show the app inside a frame (Telegram Web, A-23)            |
| `CSP_REPORT_URI`      | `<API>/csp-report`                 | where reports go                                                    |

`pnpm build` writes the header into `apps/web/dist/_headers` (Netlify / Cloudflare Pages format) and the bare policy into `apps/web/dist/csp-report-only.txt`. With another web server, send the same header. For example, nginx: `add_header Content-Security-Policy-Report-Only "<contents of csp-report-only.txt>" always;`. `pnpm --filter @cookbook/web preview` serves the build with the header, for local checks.

**Never blocked:**

- Telegram's script (`script-src https://telegram.org`);
- the YouTube player (`frame-src https://www.youtube-nocookie.com`);
- photos (`img-src` S3 origin);
- the API (`connect-src`).

There is no `unsafe-eval`. `unsafe-inline` is allowed for styles only.

## Reports

Browsers POST violations to `POST /csp-report` on the API. It has no sign-in, accepts at most 16 KB per report, has its own limit of 60 reports per minute per IP, and logs each violation as a warning:

```json
{
  "level": 40,
  "msg": "csp violation",
  "csp": {
    "directive": "img-src",
    "blocked": "https://…",
    "document": "https://…/recipe/…",
    "source": "",
    "line": null,
    "disposition": "report"
  }
}
```

Only `report-uri` is used, not `report-to`. When `report-to` is present, Chromium ignores `report-uri`, and in our test Chromium never delivered `report-to` reports (waited 70 s), while `report-uri` reports arrived immediately. WebKit (iPhone) supports `report-uri` too.

Verified locally:

- With the S3 origin deliberately left out, the photos still loaded (Report-Only does not block), and each was reported and logged as an `img-src` violation.
- With the correct origin, the book, the recipe card, the photos and the YouTube player produced **zero** violations.
- A stand-in replaced the real Telegram script, because this sandbox cannot reach telegram.org. That is one reason the real test below is needed.

## How to check the reports during the first real Telegram test

1. Open the app in Telegram on each device: iPhone, Android, Telegram Desktop, and Telegram Web in a browser. On each, open the book, a recipe card, play a video, switch the language, and (from Sprint 3) open the editor and upload a photo.
2. Open the API logs on the server and search for `csp violation`. With Docker: `docker logs <api-container> 2>&1 | grep "csp violation"`.
3. No lines means the policy fits: switch the header name to `Content-Security-Policy` (enforcing). Each line names the blocked address and the directive. Either add that origin to the policy, if it is legitimate (for example a Telegram or YouTube host), or find out why the app tried to load it.
4. Telegram Desktop can also show violations directly: Settings → Advanced → Experimental settings → "Enable webview inspecting". Then right-click the app → Inspect → Console. Violations appear as `[Report Only]`.

### По-русски: как проверить при первом запуске в настоящем Telegram

1. Откройте приложение в Telegram на iPhone, Android, Telegram Desktop и в Telegram Web. На каждом: книга, карточка рецепта, видео, смена языка, редактор и загрузка фото.
2. Откройте журнал API на сервере и найдите строки `csp violation`. Я помогу с этим шагом, когда будет сервер.
3. Если таких строк нет, защиту можно включить в «строгом» режиме (заголовок `Content-Security-Policy`). Если есть, в каждой строке видно, какой адрес и где был бы заблокирован; такие адреса разбираем до включения строгого режима.

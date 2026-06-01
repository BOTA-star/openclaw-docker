/**
 * Gmail → OpenRouter AI Summary → Telegram
 *
 * Usage:
 *   node index.js
 *   node index.js "unread"
 *   node index.js "latest unread"
 *   node index.js "earliest unread"
 *   node index.js "from:abc@gmail.com since:2026-05-18 before:2026-05-25"
 *
 * Default behavior:
 *   - If no filter is provided: lấy email CHƯA ĐỌC MỚI NHẤT
 *   - If multiple emails match: mặc định lấy email MỚI NHẤT
 */

if (String(process.env.ALLOW_INSECURE_TLS || "").toLowerCase() === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.log("WARNING: TLS certificate verification is disabled.");
}

const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");

/* =========================
   CONSTANTS
========================= */

const MAX_EMAIL_CHARS_FOR_AI = 6000;
const MAX_TELEGRAM_MESSAGE_CHARS = 3900;

/* =========================
   ENV HELPERS
========================= */

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return String(value).trim();
}

function optionalEnv(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function normalizeTelegramChatId(value = "") {
  return String(value).trim().replace(/^telegram:/i, "");
}

/* =========================
   IMAP CONFIG
========================= */

function createImapConfig() {
  const allowInsecureTls =
    String(process.env.ALLOW_INSECURE_TLS || "").toLowerCase() === "true";

  return {
    imap: {
      user: requiredEnv("EMAIL_USER"),
      password: requiredEnv("EMAIL_PASS"),
      host: optionalEnv("EMAIL_IMAP_HOST", "imap.gmail.com"),
      port: Number(optionalEnv("EMAIL_IMAP_PORT", "993")),
      tls: true,
      authTimeout: Number(optionalEnv("EMAIL_AUTH_TIMEOUT", "20000")),
      tlsOptions: {
        rejectUnauthorized: !allowInsecureTls,
      },
    },
  };
}

/* =========================
   TEXT CLEANING
========================= */

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanHtml(html = "") {
  return decodeHtmlEntities(html)
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head[^>]*>.*?<\/head>/gis, "")
    .replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePlainText(text = "") {
  return decodeHtmlEntities(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getCleanEmailText(parsed) {
  const plain = normalizePlainText(parsed.text || "");

  if (plain) {
    return plain;
  }

  return cleanHtml(parsed.html || "");
}

function truncateText(text = "", maxChars = 1000) {
  const safeText = String(text || "");

  if (safeText.length <= maxChars) {
    return safeText;
  }

  return `${safeText.slice(0, maxChars).trim()}\n\n...[content truncated]`;
}

/* =========================
   FILTER PARSING
========================= */

function stripKnownCommand(input = "") {
  return String(input)
    .replace(/^\/mail(@\w+)?\s*/i, "")
    .replace(/^\/emailsummarize(@\w+)?\s*/i, "")
    .replace(/^\/skill\s+mail\s*/i, "")
    .replace(/^\/skill\s+emailsummarize\s*/i, "")
    .trim();
}

function formatDateForImap(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function toImapDate(dateStr) {
  if (!dateStr) return null;

  const raw = String(dateStr).trim();

  if (/^\d{1,2}-[a-z]{3}-\d{4}$/i.test(raw)) {
    return raw.replace(
      /^(\d{1,2})-([a-z]{3})-(\d{4})$/i,
      (_, day, mon, year) =>
        `${Number(day)}-${mon.charAt(0).toUpperCase()}${mon.slice(1).toLowerCase()}-${year}`
    );
  }

  const vnDate = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (vnDate) {
    const [, dd, mm, yyyy] = vnDate;
    return formatDateForImap(new Date(Number(yyyy), Number(mm) - 1, Number(dd)));
  }

  const isoDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    const [, yyyy, mm, dd] = isoDate;
    return formatDateForImap(new Date(Number(yyyy), Number(mm) - 1, Number(dd)));
  }

  const d = new Date(raw);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return formatDateForImap(d);
}

function parseFilter(input = "") {
  const cleanedInput = stripKnownCommand(input);

  const filter = {
    raw: cleanedInput,
    sender: null,
    sinceDate: null,
    beforeDate: null,
    unreadOnly: false,

    // Quan trọng: mặc định lấy mail mới nhất, không lấy mail cũ nhất nữa.
    mode: "latest",
  };

  const fromMatch =
    cleanedInput.match(/\bfrom:([^\s]+)/i) ||
    cleanedInput.match(/\bsender:([^\s]+)/i);

  const sinceMatch =
    cleanedInput.match(/\bsince:([^\s]+)/i) ||
    cleanedInput.match(/\bafter:([^\s]+)/i) ||
    cleanedInput.match(/\btu:([^\s]+)/i) ||
    cleanedInput.match(/\btừ:([^\s]+)/i);

  const beforeMatch =
    cleanedInput.match(/\bbefore:([^\s]+)/i) ||
    cleanedInput.match(/\bto:([^\s]+)/i) ||
    cleanedInput.match(/\bden:([^\s]+)/i) ||
    cleanedInput.match(/\bđến:([^\s]+)/i);

  if (fromMatch) {
    filter.sender = fromMatch[1];
  }

  if (sinceMatch) {
    filter.sinceDate = toImapDate(sinceMatch[1]);
  }

  if (beforeMatch) {
    filter.beforeDate = toImapDate(beforeMatch[1]);
  }

  if (/\b(unread|unseen|chưa đọc|chua doc)\b/i.test(cleanedInput)) {
    filter.unreadOnly = true;
  }

  if (/\b(latest|newest|mới nhất|moi nhat)\b/i.test(cleanedInput)) {
    filter.mode = "latest";
  }

  if (/\b(earliest|oldest|sớm nhất|som nhat|cũ nhất|cu nhat)\b/i.test(cleanedInput)) {
    filter.mode = "earliest";
  }

  return filter;
}

function buildSearchCriteria(filter) {
  const hasAnyExplicitFilter =
    Boolean(filter.sender) ||
    Boolean(filter.sinceDate) ||
    Boolean(filter.beforeDate) ||
    Boolean(filter.unreadOnly);

  const criteria = [];

  // Nếu không truyền gì, mặc định lấy email chưa đọc.
  // Ví dụ: node index.js → search UNSEEN và lấy mail mới nhất.
  if (!hasAnyExplicitFilter || filter.unreadOnly) {
    criteria.push("UNSEEN");
  } else {
    criteria.push("ALL");
  }

  if (filter.sender) {
    criteria.push(["FROM", filter.sender]);
  }

  if (filter.sinceDate) {
    criteria.push(["SINCE", filter.sinceDate]);
  }

  if (filter.beforeDate) {
    criteria.push(["BEFORE", filter.beforeDate]);
  }

  return criteria;
}

/* =========================
   OPENROUTER SUMMARY
========================= */

async function summarize(text = "") {
  const apiKey = optionalEnv("OPENROUTER_API_KEY") || optionalEnv("OPENAI_API_KEY");

  if (!apiKey) {
    console.log("Missing OPENROUTER_API_KEY / OPENAI_API_KEY. Fallback to raw preview.");
    return truncateText(text, 700);
  }

  const baseUrl = optionalEnv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
  const model = optionalEnv("OPENROUTER_MODEL", "google/gemini-2.5-flash");

  const maxTokens = Number(optionalEnv("OPENROUTER_MAX_TOKENS", "700"));
  const contentForAi = truncateText(text, MAX_EMAIL_CHARS_FOR_AI);

  try {
    const prompt = `
Bạn là trợ lý tóm tắt email.

Hãy tóm tắt email dưới đây bằng tiếng Việt, ngắn gọn, rõ ý.

Yêu cầu output:
- Mục đích chính của email
- Thông tin quan trọng
- Việc cần làm / cần phản hồi nếu có
- Nếu email không có hành động cần làm, ghi rõ: "Chưa thấy việc cần xử lý ngay"

EMAIL:
${contentForAi}
`.trim();

    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Bạn tóm tắt email ngắn gọn, chính xác, ưu tiên thông tin cần hành động.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,

        // Quan trọng: tránh OpenRouter tự request max_tokens quá cao.
        max_tokens: maxTokens,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.log("OpenRouter error:", JSON.stringify(data, null, 2));
      return truncateText(text, 700);
    }

    return data?.choices?.[0]?.message?.content?.trim() || "Không tạo được tóm tắt.";
  } catch (err) {
    console.log("Summarize error:", err.message);
    return truncateText(text, 700);
  }
}

/* =========================
   TELEGRAM
========================= */

function formatDate(dateValue) {
  if (!dateValue) return "unknown";

  const d = new Date(dateValue);

  if (Number.isNaN(d.getTime())) {
    return String(dateValue);
  }

  return d.toLocaleString("vi-VN", {
    timeZone: optionalEnv("TZ", "Asia/Ho_Chi_Minh"),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEmail(email, filter) {
  return `
📩 EMAIL MATCHED

Filter: ${filter.raw || "unread"}
Mode: ${filter.mode === "latest" ? "mới nhất" : "sớm nhất"}

From: ${email.from}
Subject: ${email.subject}
Date: ${formatDate(email.date)}

Summary:
${email.summary}
`.trim();
}

async function sendTelegram(message) {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const rawChatId =
    optionalEnv("TELEGRAM_CHAT_ID") || optionalEnv("OPENCLAW_TELEGRAM_OWNER");

  const chatId = normalizeTelegramChatId(rawChatId);

  if (!token || !chatId) {
    console.log(
      "Missing Telegram config: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/OPENCLAW_TELEGRAM_OWNER are required."
    );
    return;
  }

  const safeMessage = truncateText(message, MAX_TELEGRAM_MESSAGE_CHARS);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: safeMessage,
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    console.log("Telegram send error:", JSON.stringify(data, null, 2));
    return;
  }

  console.log("Telegram: SENT");
}

/* =========================
   MAIL PROCESSING
========================= */

function getMailSortValue(result) {
  const uid = Number(result?.attributes?.uid || 0);

  if (uid > 0) {
    return uid;
  }

  const seqNo = Number(result?.seqNo || result?.attributes?.seqno || 0);

  if (seqNo > 0) {
    return seqNo;
  }

  return 0;
}

function pickTargetMail(results, mode = "latest") {
  const sorted = [...results].sort((a, b) => {
    return getMailSortValue(a) - getMailSortValue(b);
  });

  if (mode === "earliest") {
    return sorted[0];
  }

  return sorted[sorted.length - 1];
}

function extractRawEmail(result) {
  const rawPart =
    result?.parts?.find((p) => p.which === "") ||
    result?.parts?.find((p) => p.body);

  return rawPart?.body || "";
}

/* =========================
   MAIN
========================= */

async function run() {
  let connection;

  try {
    const rawArg = process.argv.slice(2).join(" ").trim();
    const filter = parseFilter(rawArg);
    const searchCriteria = buildSearchCriteria(filter);

    console.log("Raw input:", rawArg || "(empty)");
    console.log("Parsed filter:", filter);
    console.log("Search criteria:", JSON.stringify(searchCriteria));

    console.log("Connecting IMAP...");
    connection = await imaps.connect(createImapConfig());

    await connection.openBox("INBOX");
    console.log("INBOX opened");

    const results = await connection.search(searchCriteria, {
      bodies: [""],
      markSeen: false,
    });

    console.log("Matched emails:", results.length);

    if (!results.length) {
      const noMailMessage = `Không tìm thấy email phù hợp với filter: ${
        filter.raw || "unread"
      }`;

      console.log(noMailMessage);
      await sendTelegram(noMailMessage);
      return;
    }

    console.log("Pick mode:", filter.mode);

    const targetMail = pickTargetMail(results, filter.mode);
    const raw = extractRawEmail(targetMail);

    if (!raw) {
      const noRawMessage = "Tìm thấy email nhưng không đọc được nội dung raw email.";
      console.log(noRawMessage);
      await sendTelegram(noRawMessage);
      return;
    }

    const parsed = await simpleParser(raw);
    const cleanedText = getCleanEmailText(parsed);

    if (!cleanedText) {
      const emptyMessage =
        "Tìm thấy email nhưng nội dung email rỗng hoặc không parse được.";

      console.log(emptyMessage);
      await sendTelegram(emptyMessage);
      return;
    }

    const summary = await summarize(cleanedText);

    const email = {
      from: parsed.from?.text || "unknown",
      subject: parsed.subject || "(no subject)",
      date: parsed.date || "",
      summary,
    };

    console.log("Selected email:", {
      from: email.from,
      subject: email.subject,
      date: email.date,
    });

    const message = formatEmail(email, filter);

    await sendTelegram(message);

    console.log("DONE");
  } catch (err) {
    console.error("FATAL:", err);

    try {
      await sendTelegram(`Lỗi khi xử lý email: ${err.message}`);
    } catch (sendErr) {
      console.error("Cannot send error to Telegram:", sendErr.message);
    }

    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        connection.end();
      } catch (err) {
        console.log("Connection close warning:", err.message);
      }
    }
  }
}

run();
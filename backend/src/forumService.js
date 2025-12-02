import { load } from "cheerio";

const ABS_BASE = "https://www.boursorama.com";
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
};

const absoluteUrl = (href) => {
  if (!href) {
    return null;
  }
  try {
    return new URL(href, ABS_BASE).href;
  } catch (error) {
    return href;
  }
};

const normaliseProfileUrl = (href) => {
  if (!href) {
    return null;
  }
  const cleaned = String(href).replace(/\/_profil-light\/?$/, "/");
  return absoluteUrl(cleaned);
};

const extractNameFromProfileUrl = (href) => {
  if (!href) {
    return null;
  }
  const match = String(href).match(/\/profil\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
};

const parseInteger = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(String(value).replace(/[^0-9-]/g, ""));
  return Number.isFinite(num) ? num : null;
};

export async function fetchForumPosts(forumUrl, { limit = 3 } = {}) {
  if (!forumUrl) {
    return [];
  }
  const response = await fetch(forumUrl, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to load forum (${response.status})`);
  }
  const html = await response.text();
  const $ = load(html);
  const rows = [];

  $(".c-table__row").each((_, element) => {
    if (rows.length >= limit) {
      return false;
    }
    const $row = $(element);
    const titleLink = $row.find("a[data-tag-commander-click*='message-liste']").first();
    const title = titleLink.text().trim();
    if (!title) {
      return;
    }

    const topicUrl = absoluteUrl(titleLink.attr("href"));
    const authorLink = $row.find(".c-source__username").first();
    const rawAuthorHref =
      authorLink.attr("href") || authorLink.attr("data-popover-url") || authorLink.data("popoverUrl");
    let author = authorLink.text().trim() || null;
    const authorProfileUrl = normaliseProfileUrl(rawAuthorHref);
    if (!author) {
      author = extractNameFromProfileUrl(rawAuthorHref);
    }
    const createdAt = $row.find(".c-source__time").first().text().trim() || null;

    const lastDate = $row.find(".c-table__last-message").first().text().trim() || null;
    const lastUserButton = $row.find(".c-source__username--xx-small").first();
    const rawLastHref =
      lastUserButton.data("popoverUrl") ||
      lastUserButton.attr("data-popover-url") ||
      lastUserButton.attr("href") ||
      null;
    let lastUser = lastUserButton.text().trim() || null;
    if (!lastUser) {
      lastUser = extractNameFromProfileUrl(rawLastHref);
    }
    const lastUserProfileUrl = normaliseProfileUrl(rawLastHref);

    const likes = parseInteger($row.find(".c-table__like").first().text());
    const messages = parseInteger($row.find(".c-table__comments span").first().text());

    rows.push({
      title,
      topic_url: topicUrl,
      author,
      author_profile_url: authorProfileUrl,
      created_at: createdAt,
      last_reply_at: lastDate,
      last_reply_author: lastUser,
      last_reply_profile_url: lastUserProfileUrl,
      likes,
      messages,
    });
  });

  return rows;
}

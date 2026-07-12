import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USERNAME =
  process.env.GITHUB_USER ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  process.env.USERNAME ||
  "HenryYHong";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT_DIR, "dist");

const GRAPHQL_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const KOI_HEAD_X = 27;
const KOI_LENGTH = 66;
const KOI_POINTS = 18;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function levelForDay(day) {
  return LEVELS[day.contributionLevel] ?? 0;
}

function seededNoise(seed) {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

function fmt(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function buildDemoCalendar() {
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7);

  const weeks = [];
  let totalContributions = 0;

  for (let week = 0; week < 53; week += 1) {
    const contributionDays = [];

    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + week * 7 + weekday);

      const seasonal = 0.5 + 0.5 * Math.sin((week / 52) * Math.PI * 2);
      const focusDay = weekday >= 1 && weekday <= 5 ? 1 : 0.25;
      const noise = seededNoise(week * 7 + weekday + 11);
      const count = Math.max(0, Math.round((seasonal * 5 + noise * 6) * focusDay));
      totalContributions += count;

      let contributionLevel = "NONE";
      if (count > 0 && count <= 2) contributionLevel = "FIRST_QUARTILE";
      if (count > 2 && count <= 5) contributionLevel = "SECOND_QUARTILE";
      if (count > 5 && count <= 8) contributionLevel = "THIRD_QUARTILE";
      if (count > 8) contributionLevel = "FOURTH_QUARTILE";

      contributionDays.push({
        contributionCount: count,
        contributionLevel,
        date: date.toISOString().slice(0, 10),
        weekday,
      });
    }

    weeks.push({ contributionDays });
  }

  return { totalContributions, weeks };
}

async function fetchContributionCalendar() {
  if (!TOKEN) {
    console.warn("GITHUB_TOKEN was not found, so demo contribution data was used.");
    return buildDemoCalendar();
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "HenryYHong-koi-pond-readme",
    },
    body: JSON.stringify({
      query: GRAPHQL_QUERY,
      variables: { login: USERNAME },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("\n"));
  }

  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) {
    throw new Error(`No contribution calendar was returned for ${USERNAME}.`);
  }

  return calendar;
}

function themeFor(mode) {
  if (mode === "dark") {
    return {
      bgTop: "#123d4d",
      bgMid: "#0b6171",
      bgBottom: "#092836",
      text: "#d9fbff",
      mutedText: "#94d7df",
      ripple: "#aee9ef",
      notch: "#0e5060",
      padStroke: "#173f2e",
      pads: ["#17372d", "#2f6b3f", "#4f9852", "#78bb61", "#b2d36f"],
      flowers: ["#ff9fb2", "#ffd166", "#fff3bf"],
      shadow: "#031318",
      gridLine: "#2a7783",
    };
  }

  return {
    bgTop: "#b9f0ec",
    bgMid: "#55b8bc",
    bgBottom: "#1f6b7a",
    text: "#184e5a",
    mutedText: "#2c6e78",
    ripple: "#ebfffc",
    notch: "#77cace",
    padStroke: "#3a7d4f",
    pads: ["#d5ead7", "#a7d884", "#74be63", "#4e9d4e", "#2e793a"],
    flowers: ["#ff8eb0", "#ffd166", "#fff5c2"],
    shadow: "#10414a",
    gridLine: "#8fe1df",
  };
}

function getMonthLabels(weeks, left, top, step) {
  const labels = [];
  let lastMonth = -1;
  let lastX = -Infinity;

  weeks.forEach((week, index) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay?.date) return;

    const date = new Date(`${firstDay.date}T00:00:00Z`);
    const month = date.getUTCMonth();
    const x = left + index * step;

    if (month !== lastMonth && x - lastX > 42) {
      labels.push({
        month: MONTHS[month],
        x,
        y: top - 18,
      });
      lastMonth = month;
      lastX = x;
    }
  });

  return labels;
}

function koiBodyWidth(t) {
  const peakT = 0.2;
  const neckW = 1.14 * 0.95;

  if (t <= peakT) {
    const ht = t / peakT;
    return neckW * (0.58 + 0.42 * Math.pow(ht, 0.9));
  }

  const cone = (t - peakT) / (1 - peakT);
  return neckW * Math.max(0.025, 1 - cone);
}

function smoothThrough(points, move = true) {
  if (!points.length) return "";
  if (points.length === 1) return `${move ? "M" : "L"} ${fmt(points[0].x)} ${fmt(points[0].y)}`;

  let d = move ? `M ${fmt(points[0].x)} ${fmt(points[0].y)}` : "";
  if (!move) d += ` L ${fmt(points[0].x)} ${fmt(points[0].y)}`;

  for (let i = 1; i < points.length - 1; i += 1) {
    const mid = {
      x: (points[i].x + points[i + 1].x) * 0.5,
      y: (points[i].y + points[i + 1].y) * 0.5,
    };
    d += ` Q ${fmt(points[i].x)} ${fmt(points[i].y)} ${fmt(mid.x)} ${fmt(mid.y)}`;
  }

  const last = points[points.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

function koiBodyPath(hw) {
  const top = [];
  const bottom = [];
  const nose = { x: KOI_HEAD_X + hw * 0.42, y: 0 };

  for (let i = 0; i < KOI_POINTS; i += 1) {
    const t = i / (KOI_POINTS - 1);
    const x = KOI_HEAD_X - KOI_LENGTH * t;
    const centerY = Math.sin(t * Math.PI * 1.15) * hw * 0.05;
    const w = koiBodyWidth(t) * hw;
    top.push({ x, y: centerY - w });
    bottom.unshift({ x, y: centerY + w });
  }

  return `${smoothThrough(top)} Q ${fmt(KOI_HEAD_X - KOI_LENGTH - hw * 0.18)} 0 ${fmt(bottom[0].x)} ${fmt(bottom[0].y)} ${smoothThrough(bottom.slice(1), false)} Q ${fmt(nose.x)} ${fmt(nose.y)} ${fmt(top[0].x)} ${fmt(top[0].y)} Z`;
}

function renderScaleTexture(hw, color) {
  const scales = [];

  for (let row = 0.24; row <= 0.76; row += 0.12) {
    const x = KOI_HEAD_X - KOI_LENGTH * row;
    const centerY = Math.sin(row * Math.PI * 1.15) * hw * 0.05;
    const bodyW = koiBodyWidth(row) * hw * 0.7;
    const cols = Math.max(2, Math.floor(bodyW / 2.7));

    for (let col = 0; col < cols; col += 1) {
      const lateral = (col + 0.5) / cols - 0.5;
      const y = centerY + lateral * bodyW * 1.55;
      scales.push(
        `<circle cx="${fmt(x + ((col % 2) - 0.5) * 0.55)}" cy="${fmt(y)}" r="${fmt(0.52 + hw * 0.012)}" fill="${color}" />`,
      );
    }
  }

  return scales.join("\n");
}

function renderPad(day, x, y, cell, theme, weekIndex) {
  const level = levelForDay(day);
  const count = day.contributionCount;
  const angle = ((weekIndex * 23 + day.weekday * 31) % 36) - 18;
  const scale = count > 0 ? 1 + level * 0.04 : 0.72;
  const fill = theme.pads[level];
  const rx = (cell * 0.48).toFixed(2);
  const ry = (cell * 0.4).toFixed(2);
  const title = `${day.date}: ${count} contribution${count === 1 ? "" : "s"}`;

  if (level === 0) {
    return `
    <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle}) scale(${scale.toFixed(2)})" opacity="0.36">
      <title>${escapeXml(title)}</title>
      <ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" fill="none" stroke="${theme.ripple}" stroke-width="0.8" />
    </g>`;
  }

  const flower =
    level >= 3
      ? `
        <g transform="translate(${(cell * 0.22).toFixed(2)} ${(-cell * 0.18).toFixed(2)}) scale(${(0.72 + level * 0.05).toFixed(2)})">
          <circle cx="-1.7" cy="0" r="1.7" fill="${theme.flowers[0]}" />
          <circle cx="1.7" cy="0" r="1.7" fill="${theme.flowers[0]}" />
          <circle cx="0" cy="-1.8" r="1.7" fill="${theme.flowers[0]}" />
          <circle cx="0" cy="0" r="1.2" fill="${theme.flowers[1]}" />
        </g>`
      : "";

  return `
    <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle}) scale(${scale.toFixed(2)})">
      <title>${escapeXml(title)}</title>
      <ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${theme.padStroke}" stroke-width="0.75" />
      <path d="M 0 0 L ${rx} ${(-cell * 0.22).toFixed(2)} A ${rx} ${ry} 0 0 1 ${rx} ${(cell * 0.2).toFixed(2)} Z" fill="${theme.notch}" opacity="0.94" />
      <path d="M ${(-cell * 0.24).toFixed(2)} 0 C ${(-cell * 0.06).toFixed(2)} ${(-cell * 0.08).toFixed(2)}, ${(cell * 0.18).toFixed(2)} ${(-cell * 0.08).toFixed(2)}, ${(cell * 0.34).toFixed(2)} ${(-cell * 0.2).toFixed(2)}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.65" stroke-linecap="round" />
      ${flower}
    </g>`;
}

function renderKoiPatch(patch) {
  return `
          <g transform="translate(${fmt(patch.x)} ${fmt(patch.y)}) rotate(${fmt(patch.rot || 0)})">
            <ellipse cx="0" cy="0" rx="${fmt(patch.rx)}" ry="${fmt(patch.ry)}" fill="${patch.fill}" opacity="${patch.opacity ?? 0.96}" />
            <ellipse cx="${fmt(-patch.rx * 0.08)}" cy="${fmt(patch.ry * 0.08)}" rx="${fmt(patch.rx * 0.58)}" ry="${fmt(patch.ry * 0.46)}" fill="${patch.shade}" opacity="0.7" />
          </g>`;
}

function renderKoi({
  id,
  path,
  duration,
  delay,
  scale,
  bodyStops,
  finStops,
  dorsalColor,
  scaleColor,
  patches,
}) {
  const hw = 12;
  const bodyPath = koiBodyPath(hw);
  const bodyId = `${id}-body`;
  const finId = `${id}-fin`;
  const clipId = `${id}-clip`;
  const tailX = KOI_HEAD_X - KOI_LENGTH;

  return `
    <g opacity="0.96" filter="url(#softShadow)">
      <animateMotion dur="${duration}s" begin="${delay}s" repeatCount="indefinite" rotate="auto" path="${path}" />
      <g transform="scale(${scale})">
        <defs>
          <linearGradient id="${bodyId}" x1="-42" x2="34" y1="-16" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="${bodyStops[0]}" />
            <stop offset="35%" stop-color="${bodyStops[1]}" />
            <stop offset="68%" stop-color="${bodyStops[2]}" />
            <stop offset="100%" stop-color="${bodyStops[3]}" />
          </linearGradient>
          <linearGradient id="${finId}" x1="-42" x2="18" y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="${finStops[2]}" />
            <stop offset="48%" stop-color="${finStops[1]}" />
            <stop offset="100%" stop-color="${finStops[0]}" />
          </linearGradient>
          <clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">
            <path d="${bodyPath}" />
          </clipPath>
        </defs>

        <g transform="translate(${fmt(tailX - 1)} 0)" opacity="0.82">
          <g>
            <animateTransform attributeName="transform" type="rotate" values="-7;7;-7" dur="1.9s" repeatCount="indefinite" />
            <path d="M 2 0 C -8 -13 -22 -14 -29 -4 C -18 -4 -8 -1 2 0 Z" fill="url(#${finId})" />
            <path d="M 2 0 C -8 13 -22 14 -29 4 C -18 4 -8 1 2 0 Z" fill="url(#${finId})" />
          </g>
        </g>

        <path d="M 3 -8.6 C -5 -20 -18 -17 -15 -5 C -8 -6 0 -5.6 5 -3.8 Z" fill="url(#${finId})" opacity="0.62" />
        <path d="M 3 8.6 C -5 20 -18 17 -15 5 C -8 6 0 5.6 5 3.8 Z" fill="url(#${finId})" opacity="0.62" />

        <path d="${bodyPath}" fill="url(#${bodyId})" stroke="rgba(38,34,26,0.22)" stroke-width="0.9" />
        <g clip-path="url(#${clipId})">
          ${renderScaleTexture(hw, scaleColor)}
          ${(patches || []).map(renderKoiPatch).join("\n")}
        </g>

        <path d="M 18 0 C 7 -1.6 -9 -1.8 -30 0.4" fill="none" stroke="${dorsalColor}" stroke-width="1.25" stroke-linecap="round" opacity="0.78" />
        <path d="M 18 -0.3 C 8 1.1 -11 1.4 -31 -0.4" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.55" stroke-linecap="round" opacity="0.55" />
        <circle cx="28.5" cy="-3.8" r="1.15" fill="#2b2118" opacity="0.86" />
        <circle cx="28.5" cy="3.8" r="1.15" fill="#2b2118" opacity="0.86" />
        <circle cx="28.85" cy="-4.15" r="0.33" fill="#fff6e6" opacity="0.9" />
        <circle cx="28.85" cy="3.45" r="0.33" fill="#fff6e6" opacity="0.9" />
        <path d="M 31.2 -3.4 C 35.4 -5.2 38.4 -7.4 41.8 -10" fill="none" stroke="${dorsalColor}" stroke-width="0.78" stroke-linecap="round" opacity="0.64" />
        <path d="M 31.2 3.4 C 35.4 5.2 38.4 7.4 41.8 10" fill="none" stroke="${dorsalColor}" stroke-width="0.78" stroke-linecap="round" opacity="0.64" />
      </g>
    </g>`;
}

function renderSvg(calendar, mode) {
  const theme = themeFor(mode);
  const weeks = calendar.weeks;
  const flatDays = weeks.flatMap((week) => week.contributionDays);
  const totalContributions =
    calendar.totalContributions ??
    flatDays.reduce((total, day) => total + day.contributionCount, 0);

  const width = 960;
  const height = 300;
  const cell = 11;
  const gap = 5;
  const step = cell + gap;
  const left = 62;
  const top = 88;
  const gridWidth = weeks.length * step - gap;
  const gridHeight = 7 * step - gap;
  const idSuffix = mode;

  const pads = weeks
    .map((week, weekIndex) =>
      week.contributionDays
        .map((day) => {
          const x = left + weekIndex * step + cell / 2;
          const y = top + day.weekday * step + cell / 2;
          return renderPad(day, x, y, cell, theme, weekIndex);
        })
        .join("\n"),
    )
    .join("\n");

  const monthLabels = getMonthLabels(weeks, left, top, step)
    .map(
      (label) =>
        `<text x="${label.x.toFixed(1)}" y="${label.y}" class="label">${label.month}</text>`,
    )
    .join("\n");

  const weekdayLabels = [
    { label: "Mon", row: 1 },
    { label: "Wed", row: 3 },
    { label: "Fri", row: 5 },
  ]
    .map(
      (item) =>
        `<text x="${left - 38}" y="${top + item.row * step + cell * 0.82}" class="label">${item.label}</text>`,
    )
    .join("\n");

  const koi = [
    renderKoi({
      id: `${idSuffix}-kohaku`,
      path: `M ${left - 10} ${top + 25} C ${left + 160} ${top - 18}, ${left + 295} ${top + 112}, ${left + 475} ${top + 68} S ${left + 735} ${top - 8}, ${left + gridWidth + 12} ${top + 74} C ${left + 720} ${top + 148}, ${left + 430} ${top + 126}, ${left + 220} ${top + 154} S ${left + 28} ${top + 122}, ${left - 10} ${top + 25}`,
      duration: 34,
      delay: -8,
      scale: 1.08,
      bodyStops: ["#ded8cc", "#fff9ee", "#f4eadb", "#d0c5b5"],
      finStops: ["#f8f4eb", "#e0d8cc", "#bcb0a0"],
      dorsalColor: "rgba(210, 202, 190, 0.78)",
      scaleColor: "rgba(126, 114, 98, 0.08)",
      patches: [
        { x: 8, y: -4.6, rx: 8.6, ry: 4.7, rot: -14, fill: "#d63f28", shade: "rgba(150, 36, 22, 0.18)" },
        { x: -8.5, y: 3.4, rx: 10.5, ry: 5.3, rot: 12, fill: "#e15c2c", shade: "rgba(154, 54, 22, 0.16)" },
        { x: 19.5, y: 1.3, rx: 4.8, ry: 3.2, rot: -18, fill: "#ef7a2d", shade: "rgba(160, 70, 20, 0.16)" },
      ],
    }),
    renderKoi({
      id: `${idSuffix}-yamabuki`,
      path: `M ${left + gridWidth - 20} ${top + 138} C ${left + 690} ${top + 62}, ${left + 520} ${top + 166}, ${left + 330} ${top + 105} S ${left + 96} ${top + 38}, ${left + 10} ${top + 138} C ${left + 170} ${top + 178}, ${left + 535} ${top + 176}, ${left + gridWidth - 20} ${top + 138}`,
      duration: 41,
      delay: -20,
      scale: 0.92,
      bodyStops: ["#d7ac43", "#ffe8a1", "#e0a534", "#a96f1b"],
      finStops: ["#ffe086", "#e6aa48", "#aa6a22"],
      dorsalColor: "rgba(218, 146, 36, 0.68)",
      scaleColor: "rgba(92, 58, 20, 0.09)",
      patches: [],
    }),
    renderKoi({
      id: `${idSuffix}-orange`,
      path: `M ${left + 55} ${top + 112} C ${left + 210} ${top + 54}, ${left + 335} ${top + 190}, ${left + 515} ${top + 128} S ${left + 735} ${top + 74}, ${left + gridWidth - 60} ${top + 30} C ${left + 765} ${top + 106}, ${left + 565} ${top + 32}, ${left + 376} ${top + 72} S ${left + 128} ${top + 164}, ${left + 55} ${top + 112}`,
      duration: 47,
      delay: -31,
      scale: 0.82,
      bodyStops: ["#bd612b", "#e88a3b", "#c86c2d", "#88421f"],
      finStops: ["#da7630", "#a6481c", "#642a14"],
      dorsalColor: "rgba(184, 82, 32, 0.62)",
      scaleColor: "rgba(70, 34, 14, 0.08)",
      patches: [],
    }),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/generate-koi-pond.mjs. Do not edit this file by hand. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(USERNAME)} contribution koi pond</title>
  <desc id="desc">A koi pond visualization of ${escapeXml(USERNAME)}'s GitHub contributions. Each lily pad represents a day, and brighter pads represent more contributions.</desc>
  <defs>
    <linearGradient id="water-${idSuffix}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${theme.bgTop}" />
      <stop offset="52%" stop-color="${theme.bgMid}" />
      <stop offset="100%" stop-color="${theme.bgBottom}" />
    </linearGradient>
    <filter id="softShadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="${theme.shadow}" flood-opacity="0.26" />
    </filter>
    <style>
      .title { font: 700 20px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${theme.text}; }
      .subtle { font: 500 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${theme.mutedText}; }
      .label { font: 600 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${theme.mutedText}; opacity: 0.86; }
    </style>
  </defs>

  <rect width="${width}" height="${height}" rx="22" fill="url(#water-${idSuffix})" />
  <path d="M 36 67 C 155 28, 274 66, 412 42 S 672 38, 882 68" fill="none" stroke="${theme.ripple}" stroke-width="1.4" opacity="0.25" />
  <path d="M 58 242 C 205 214, 338 260, 490 234 S 754 211, 908 246" fill="none" stroke="${theme.ripple}" stroke-width="1.2" opacity="0.18" />
  <path d="M ${left - 12} ${top - 12} H ${left + gridWidth + 12} V ${top + gridHeight + 12} H ${left - 12} Z" fill="none" stroke="${theme.gridLine}" stroke-width="1" opacity="0.22" />

  <text x="${left}" y="36" class="title">Contribution koi pond</text>
  <text x="${left + 255}" y="36" class="subtle">${totalContributions.toLocaleString("en-US")} contributions in the last year</text>

  ${monthLabels}
  ${weekdayLabels}
  <g>
    ${pads}
  </g>
  <g>
    ${koi}
  </g>
</svg>
`;
}

async function main() {
  const calendar = await fetchContributionCalendar();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "koi-pond.svg"), renderSvg(calendar, "light"));
  writeFileSync(resolve(OUT_DIR, "koi-pond-dark.svg"), renderSvg(calendar, "dark"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

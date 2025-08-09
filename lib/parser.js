// lib/parser.js
export function parseMessageToBets(text) {
  if (!text) return [];

  // split by comma or newline
  const parts = text
    .split(/\n|,/)
    .map(s => s.trim())
    .filter(Boolean);

  const bets = [];
  for (let part of parts) {
    // normalize multiple separators to a single space
    part = part.replace(/\s+/g, " ");

    // patterns:
    // 22-500, 22_500, 22 500, 22d500, 22d 500, 22d500 (d as delimiter)
    let m = part.match(/^(\d{1,2})\s*[-_dD]?\s*(\d+)$/);
    if (m) {
      const num = pad2(m[1]);
      bets.push({ number: num, amount: parseInt(m[2], 10) });
      continue;
    }

    // pattern: concatenated like 22500 (ambiguous) -> require separator; skip

    // pattern: "22 500" (space) handled above by normalization + regex
    // pattern: "22d500" covered

    // pattern: with explicit 'r'/'R' -> reverse both numbers
    // e.g., 15r500 or 15R500 -> produce 15 and 51 with same amount
    m = part.match(/^(\d{1,2})\s*[rR]\s*(\d+)$/);
    if (m) {
      const num = pad2(m[1]);
      const rev = reverse2(num);
      bets.push({ number: num, amount: parseInt(m[2], 10) });
      // include reversed
      bets.push({ number: rev, amount: parseInt(m[2], 10) });
      continue;
    }

    // pattern: "22d500" with letter 'd' already caught. also accept "22D500".

    // pattern: "22=500" or "22= 500"
    m = part.match(/^(\d{1,2})\s*=\s*(\d+)$/);
    if (m) {
      const num = pad2(m[1]);
      bets.push({ number: num, amount: parseInt(m[2], 10) });
      continue;
    }

    // if none matched, try "xx yy" fallback (two numbers separated by space)
    m = part.match(/^(\d{1,2})\s+(\d+)$/);
    if (m) {
      const num = pad2(m[1]);
      bets.push({ number: num, amount: parseInt(m[2], 10) });
      continue;
    }

    // else ignore invalid part
  }

  return bets;
}

function pad2(s) {
  const n = String(s);
  return n.length === 1 ? "0" + n : n;
}

function reverse2(s) {
  // s expected two chars like "15" -> "51"
  const t = String(s).padStart(2, "0");
  return t.split("").reverse().join("");
}

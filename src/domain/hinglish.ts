/**
 * Hinglish style layer: Devanagari Hindi (from the offline translator) -> conversational Roman
 * Hindi with common English loanwords restored. This is a deterministic transliteration and
 * lexicon pass, not a language model. Speech still uses the Hindi voice on the Devanagari text.
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e',
};

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  // precomposed nukta forms
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
};

const NUKTA_FORMS: Record<string, string> = { 'क': 'q', 'ख': 'kh', 'ग': 'gh', 'ज': 'z', 'ड': 'd', 'ढ': 'rh', 'फ': 'f' };

const VIRAMA = '्';
const NUKTA = '़';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const DIGITS = '०१२३४५६७८९';

/** Frequent function words and loanwords, written the way Hinglish users type them. */
const LEXICON: Record<string, string> = {
  'है': 'hai', 'हैं': 'hain', 'मैं': 'main', 'में': 'mein', 'नहीं': 'nahi', 'क्या': 'kya',
  'हाँ': 'haan', 'हां': 'haan', 'यह': 'yeh', 'ये': 'ye', 'वह': 'woh', 'वो': 'woh', 'और': 'aur',
  'तो': 'toh', 'को': 'ko', 'से': 'se', 'के': 'ke', 'की': 'ki', 'का': 'ka', 'कि': 'ki', 'हम': 'hum',
  'तुम': 'tum', 'आप': 'aap', 'भी': 'bhi', 'ही': 'hi', 'था': 'tha', 'थी': 'thi', 'थे': 'the',
  'एक': 'ek', 'लेकिन': 'lekin', 'क्यों': 'kyun', 'कहाँ': 'kahan', 'यहाँ': 'yahan', 'वहाँ': 'wahan',
  'अब': 'ab', 'जब': 'jab', 'सब': 'sab', 'कुछ': 'kuch', 'बहुत': 'bahut', 'मुझे': 'mujhe',
  'हमें': 'humein', 'तुम्हें': 'tumhe', 'उन्हें': 'unhe', 'कौन': 'kaun', 'कैसे': 'kaise', 'चलो': 'chalo',
  'ठीक': 'theek', 'धन्यवाद': 'dhanyavaad', 'शुक्रिया': 'shukriya', 'प्यार': 'pyaar', 'दोस्त': 'dost',
  // English loanwords restored to English spelling
  'स्टेशन': 'station', 'मिनट': 'minute', 'मिनिट': 'minute', 'फोन': 'phone', 'फ़ोन': 'phone',
  'टाइम': 'time', 'ओके': 'OK', 'प्लीज़': 'please', 'प्लीज': 'please', 'सॉरी': 'sorry',
  'थैंक्स': 'thanks', 'डॉक्टर': 'doctor', 'पुलिस': 'police', 'कार': 'car', 'ट्रेन': 'train',
  'प्लान': 'plan', 'मिशन': 'mission', 'टीम': 'team', 'ऑफिस': 'office', 'कंप्यूटर': 'computer',
  'मूवी': 'movie', 'फिल्म': 'film', 'होटल': 'hotel', 'स्कूल': 'school', 'बस': 'bus',
  'सर': 'sir', 'मैडम': 'madam', 'हेलो': 'hello', 'बाय': 'bye', 'प्लैनेट': 'planet',
};

const LOANWORD_VALUES = new Set([
  'station', 'minute', 'phone', 'time', 'OK', 'please', 'sorry', 'thanks', 'doctor', 'police', 'car', 'train', 'plan',
  'mission', 'team', 'office', 'computer', 'movie', 'film', 'hotel', 'school', 'bus', 'sir', 'madam', 'hello', 'bye', 'planet',
]);

const LEX: Record<string, string> = Object.fromEntries(
  Object.entries(LEXICON).map(([k, v]) => [k.normalize('NFC'), v]),
);

type Unit = { text: string; vowel: string | null; inherent: boolean; consonant: boolean; mod: string };

function tokenize(word: string): Unit[] {
  const chars = Array.from(word);
  const units: Unit[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const isGya = c === 'ज' && chars[i + 1] === VIRAMA && chars[i + 2] === 'ञ';
    if (isGya || CONSONANTS[c] !== undefined) {
      let text = isGya ? 'gy' : CONSONANTS[c];
      if (isGya) {
        i += 2;
      } else if (chars[i + 1] === NUKTA) {
        text = NUKTA_FORMS[c] ?? text;
        i++;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        units.push({ text, vowel: null, inherent: false, consonant: true, mod: '' });
        i++;
      } else if (next !== undefined && MATRAS[next] !== undefined) {
        units.push({ text, vowel: MATRAS[next], inherent: false, consonant: true, mod: '' });
        i++;
      } else {
        units.push({ text, vowel: 'a', inherent: true, consonant: true, mod: '' });
      }
      continue;
    }
    if (VOWELS[c] !== undefined) {
      units.push({ text: '', vowel: VOWELS[c], inherent: false, consonant: false, mod: '' });
      continue;
    }
    if (c === ANUSVARA || c === CHANDRABINDU) {
      if (units.length) units[units.length - 1].mod += 'n';
      continue;
    }
    if (c === VISARGA) {
      if (units.length) units[units.length - 1].mod += 'h';
      continue;
    }
    const d = DIGITS.indexOf(c);
    units.push({ text: d >= 0 ? String(d) : c, vowel: null, inherent: false, consonant: false, mod: '' });
  }
  return units;
}

/** Schwa deletion: drop the inherent "a" word-finally and in V C a C V contexts (right to left). */
function deleteSchwas(units: Unit[]): void {
  const hasVowel = (u: Unit | undefined) => !!u && u.vowel !== null;
  const last = units.length - 1;
  if (units.length > 1 && units[last].inherent && !units[last].mod) units[last].vowel = null;
  for (let i = last - 1; i >= 1; i--) {
    const u = units[i];
    if (!u.inherent || u.vowel === null || u.mod) continue;
    const next = units[i + 1];
    if (hasVowel(units[i - 1]) && next.consonant && hasVowel(next)) u.vowel = null;
  }
}

function styleWord(input: string): string {
  // Casual spelling shortens a long "aa" before another vowel: bulaao -> bulao, khaao -> khao.
  const roman = input.length > 4 ? input.replace(/aa(?=[eiou])/g, 'a') : input;
  if (roman.length > 3 && roman.endsWith('aa')) return roman.slice(0, -1);
  if (roman.length > 3 && roman.endsWith('een')) return roman.slice(0, -3) + 'in';
  if (roman.length > 2 && roman.endsWith('ee')) return roman.slice(0, -1);
  return roman;
}

export type HinglishStyle = 'devanagari' | 'roman' | 'hinglish';

export function transliterateWord(word: string, restoreLoanwords = true): string {
  const lex = LEX[word.normalize('NFC')];
  if (lex && (restoreLoanwords || !LOANWORD_VALUES.has(lex))) return lex;
  if (!/[ऀ-ॿ]/.test(word)) return word;
  const units = tokenize(word);
  deleteSchwas(units);
  const roman = units.map((u) => u.text + (u.vowel ?? '') + u.mod).join('');
  return styleWord(roman);
}

/**
 * Consonant skeleton used to recognise English words that the translator transliterated into
 * Devanagari (names, loanwords): "station" and "स्टेशन" (steshan) both reduce to "stSn".
 */
export function skeleton(word: string, english: boolean): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (english) {
    w = w
      .replace(/[ts]ion/g, 'shan')
      .replace(/ph/g, 'f')
      .replace(/ck/g, 'k')
      .replace(/c(?=[eiy])/g, 's')
      .replace(/c/g, 'k')
      .replace(/q/g, 'k')
      .replace(/x/g, 'ks')
      .replace(/w/g, 'v');
  }
  w = w
    .replace(/sh/g, 'S')
    .replace(/chh|ch/g, 'C')
    .replace(/([tdbkgp])h/g, '$1')
    .replace(/z/g, 'j')
    .replace(/[aeiouyh]/g, '')
    .replace(/(.)+/g, '$1');
  return w;
}

/**
 * Converts Devanagari Hindi to Roman script.
 * - `roman`: phonetic Roman Hindi only.
 * - `hinglish`: also restores common English loanwords and any English word from `sourceText`
 *   that the translator merely transliterated (names, technical terms), keeping its original spelling.
 * - `devanagari`: returns the Hindi text unchanged.
 */
export function toHinglish(text: string, style: HinglishStyle = 'hinglish', sourceText?: string): string {
  if (style === 'devanagari') return text;
  const restore = style === 'hinglish';
  const englishWords = new Map<string, string>();
  if (restore && sourceText) {
    for (const w of sourceText.match(/[A-Za-z][A-Za-z'-]{3,}/g) ?? []) {
      const sk = skeleton(w, true);
      if (sk.length >= 2 && !englishWords.has(sk)) englishWords.set(sk, w);
    }
  }
  const normalized = text.replace(/॥|।/g, '.').normalize('NFC');
  const out = normalized.replace(/[ऀ-ॿ‌‍]+/g, (raw) => {
    const w = raw.replace(/[‌‍]/g, '');
    const roman = transliterateWord(w, restore);
    if (englishWords.size && !LEX[w.normalize('NFC')]) {
      const match = englishWords.get(skeleton(roman, false));
      if (match) return /^[A-Z]/.test(match) ? match : match.toLowerCase();
    }
    return roman;
  });
  return out.replace(/(^\s*|[.?!]\s+)([a-z])/g, (_m, p: string, ch: string) => p + ch.toUpperCase());
}

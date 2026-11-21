// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Original implementation, written from the task specification in
// competition.yaml / RULES.txt. It reads a CSV text once, left to right,
// and returns {columns, rows, errors} exactly as csv-reader 1.0.0 does:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (error stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled
//     ("" inside it is one quote, each CRLF or lone CR inside it is read as LF);
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (error quote_junk, when the field ends); a quote that
//     never closes is a literal character, and the text after it is read again as
//     unquoted (error unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line is the 1-based line
//     its record starts on (counting every LF, CRLF and lone CR inside quotes),
//     row is its record's index in rows (null for the header).
//
// Speed comes from a hybrid scan. Most records are clean (no quotes, no stray
// CR), and those are taken with one slice + String.split(',') after locating
// the record end with indexOf. Records that hold a quote or a stray CR are
// read field by field: an unquoted field is one slice to the next comma or
// line break (the next '\n' / '\r' are tracked lazily, and a stray CR inside
// the slice falls back to the slow reader), a quoted field is one closing-quote
// scan plus a slice. No per-character loops on the hot path, no result
// objects per field (the field just read is kept in shared locals), no
// regular expressions on the hot path, no caching between cases.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const LF = 10; // '\n'
const CR = 13; // '\r'
const COMMA = 44; // ','
const QUOTE = 34; // '"'

// How the field just read ended: 0 end of text, 1 comma, 2 line break.
const END = 0;
const COMMA_END = 1;
const BREAK_END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null: the header). Updated at the top of every record.
  let recordLine = 1;
  let recordRow = null;

  // The field just read, kept in shared locals so no result object is built
  // per field: its value, how it ended, and (for the junk after a closing
  // quote) how many characters the junk added.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  // The next '\n' / '\r' at or after pos, or -1 when there is none left. The
  // record loop sets them at the start of a record; the field loop refreshes
  // each when a quoted field has consumed the character it pointed at.
  let nl = -1;
  let nr = -1;

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Slow path, used only when
  // a stray CR is known to be inside the field, and for the junk that follows
  // a closing quote. Sets fValue / fEnded / fAdded.
  function readUnquotedSlow(value) {
    let added = 0;
    while (pos < n) {
      let c = text.indexOf(',', pos);
      let l = text.indexOf('\n', pos);
      let r = text.indexOf('\r', pos);
      let end = n;
      let kind = END;
      if (c !== -1 && c < end) { end = c; kind = COMMA_END; }
      if (l !== -1 && l < end) { end = l; kind = BREAK_END; }
      if (r !== -1 && r < end) { end = r; kind = 3; }
      if (end > pos) {
        value += text.slice(pos, end);
        added += end - pos;
        pos = end;
      }
      if (kind === END) break;
      if (kind === COMMA_END) {
        pos += 1;
        fValue = value;
        fEnded = COMMA_END;
        fAdded = added;
        return;
      }
      if (kind === BREAK_END) {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = BREAK_END;
        fAdded = added;
        return;
      }
      // kind === 3: a CR.
      if (text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = BREAK_END;
        fAdded = added;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos += 1;
    }
    fValue = value;
    fEnded = END;
    fAdded = added;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue / fEnded
  // (fAdded is 0 unless the junk after the closing quote added characters).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Refresh the next line break / CR: a quoted field earlier in this record
    // may have consumed the one they pointed at.
    if (nl !== -1 && pos > nl) nl = text.indexOf('\n', pos);
    if (nr !== -1 && pos > nr) nr = text.indexOf('\r', pos);
    let p = pos + 1;
    let hasDQ = false;
    let closedAt = -1;
    while (true) {
      const q = text.indexOf('"', p);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === QUOTE) {
        hasDQ = true;
        p = q + 2;
        continue;
      }
      closedAt = q;
      break;
    }
    if (closedAt === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted. `line` is still openLine here: the scan
      // above never touched it, so the re-read counts from the open line.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      readUnquotedSlow('"');
      return;
    }
    const content = text.slice(open + 1, closedAt);
    let value;
    // The first '\n' / '\r' at or after the opening quote is nl / nr, so the
    // content holds one exactly when that position falls before the closing quote.
    const hasNL = nl !== -1 && nl < closedAt;
    const hasCR = nr !== -1 && nr < closedAt;
    if (!hasDQ && !hasNL && !hasCR) {
      value = content;
    } else {
      // Count the line breaks the content holds (each LF, each CRLF and each
      // lone CR inside quotes is one), then build the value: "" becomes one
      // quote, each CRLF or lone CR becomes LF.
      let breaks = 0;
      for (let i = 0; i < content.length; i++) {
        const cc = content.charCodeAt(i);
        if (cc === LF) breaks += 1;
        else if (cc === CR) {
          breaks += 1;
          if (content.charCodeAt(i + 1) === LF) i += 1;
        }
      }
      line += breaks;
      value = hasDQ ? content.split('""').join('"') : content;
      if (hasCR) value = value.replace(/\r\n?/g, '\n');
    }
    pos = closedAt + 1;
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      fValue = value;
      fEnded = COMMA_END;
      fAdded = 0;
      return;
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = BREAK_END;
      fAdded = 0;
      return;
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = BREAK_END;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    readUnquotedSlow(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Finishes a record: applies the width rule (header / short / long) and
  // stores it. Returns false when the record is skipped (one empty unquoted
  // field), true when it was stored or became the header.
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return false;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return true;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record ends at the next LF (or at the end of the text).
    // When the record holds no quote and no CR other than a trailing CRLF one,
    // its fields are one slice split on commas. `nr` (the next CR from here)
    // is kept for the careful path, which reads quoted fields with it.
    nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? n : nl;
    const q = text.indexOf('"', pos);
    const hasQuote = q !== -1 && q < segEnd;
    const r = text.indexOf('\r', pos);
    nr = r;
    const hasInteriorCR = r !== -1 && r < segEnd && !(nl !== -1 && r === segEnd - 1);
    if (!hasQuote && !hasInteriorCR) {
      let end = segEnd;
      if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === CR) end -= 1;
      const fields = text.slice(pos, end).split(',');
      pos = nl === -1 ? n : nl + 1;
      line += 1;
      finishRecord(fields, false);
      continue;
    }

    // Careful path: the record holds a quote or a stray CR. `nl` / `nr` (set
    // above) are the next line break / CR from the record start; the field
    // loop refreshes each when a quoted field has consumed it.
    const fields = [];
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === QUOTE) {
        quoted = true;
        readQuoted();
        fields.push(fValue);
      } else {
        quoted = false;
        // Unquoted field: one slice to the next comma or line break. A CR
        // inside the slice is either the CRLF ending (dropped) or a stray CR
        // (slow path).
        if (nl !== -1 && pos > nl) nl = text.indexOf('\n', pos);
        const c = text.indexOf(',', pos);
        let end;
        let ended;
        if (c !== -1 && (nl === -1 || c < nl)) {
          end = c;
          ended = COMMA_END;
        } else if (nl !== -1) {
          end = nl;
          ended = BREAK_END;
        } else {
          end = n;
          ended = END;
        }
        let sliceEnd = end;
        if (ended === BREAK_END && sliceEnd > pos && text.charCodeAt(sliceEnd - 1) === CR) sliceEnd -= 1;
        let value = text.slice(pos, sliceEnd);
        if (value.indexOf('\r') !== -1) {
          readUnquotedSlow('');
          fields.push(fValue);
          ended = fEnded;
        } else {
          if (ended === COMMA_END) pos = end + 1;
          else if (ended === BREAK_END) {
            pos = end + 1;
            line += 1;
          } else {
            pos = n;
          }
          fields.push(value);
          fEnded = ended;
        }
      }
    } while (fEnded === COMMA_END);

    finishRecord(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

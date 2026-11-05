import { analyzeLexicon } from "../analytics.js";
import { formatPhonemic } from "../notation.js";
import { esc, icon } from "../ui.js";

// A per-language analytics tab: type/token phoneme frequency, onset and coda
// counts from the syllabifier, unused vs. un-charted sounds, C/V balance,
// inventory symmetry checks, and an allophone-leakage detector. Everything is
// derived on render — like the phonotactics check and the cognate matrix, no
// new state is stored.

const freq = (value) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

function barMarkup(count, max) {
  if (!count || !max) return "";
  const width = Math.max(2, Math.round((count / max) * 100));
  return `<span class="freq-bar-wrap"><span class="freq-bar" style="width:${width}%"></span></span>`;
}

function summaryChip(label, value) {
  return `<span><strong>${esc(value)}</strong> ${esc(label)}</span>`;
}

function soundToken(value, charted) {
  const mark = charted ? "" : `<span class="status-chip status-invalid analysis-offchart" title="This sound is not on the language’s charts">off chart</span>`;
  return `<code class="ipa">${esc(value)}</code>${mark}`;
}

function frequencyPanel(analysis) {
  const rows = analysis.frequency;
  const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0);

  const neverUsed = analysis.neverUsed.length
    ? `<div class="analysis-note">${icon("info")}<span><strong>${analysis.neverUsed.length}</strong> charted ${analysis.neverUsed.length === 1 ? "sound has" : "sounds have"} no recorded token: ${analysis.neverUsed
        .map((sound) => `<code class="ipa">${esc(sound)}</code>`)
        .join(" ")}</span></div>`
    : "";
  const uncharted = analysis.uncharted.length
    ? `<div class="analysis-note analysis-note-warn">${icon("warning")}<span><strong>${analysis.uncharted.length}</strong> recorded ${analysis.uncharted.length === 1 ? "sound is" : "sounds are"} not charted: ${analysis.uncharted
        .map((entry) => `<code class="ipa">${esc(entry.value)}</code>×${entry.count}`)
        .join(", ")}</span></div>`
    : "";

  return `
    <section class="panel analytics-panel">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Phoneme frequency</h2>
          <p>Type and token count over the ${analysis.recorded} recorded ${analysis.recorded === 1 ? "form" : "forms"} (${analysis.tokenTotal} segments).</p>
        </div>
        <span class="panel-icon">${icon("grid")}</span>
      </header>
      ${
        rows.length
          ? `
            ${neverUsed}${uncharted}
            <div class="table-scroll">
              <table class="data-table freq-table">
                <thead><tr><th>Sound</th><th>Tokens</th><th></th></tr></thead>
                <tbody>${rows
                  .map(
                    (row) => `
                      <tr>
                        <td class="freq-sound">${soundToken(row.value, row.charted)}</td>
                        <td class="freq-count">${row.count}</td>
                        <td class="freq-bar-cell">${barMarkup(row.count, max)}</td>
                      </tr>`
                  )
                  .join("")}</tbody>
              </table>
            </div>`
          : `<div class="notice notice-quiet">${icon("book")}<p>No recorded words yet — frequency appears once the vocabulary has forms.</p></div>`
      }
    </section>`;
}

function clusterPanel(title, rows, note) {
  return `
    <section class="panel analytics-panel analytics-cluster">
      <header class="panel-head">
        <div class="panel-title">
          <h2>${esc(title)}</h2>
          <p>${esc(note)}</p>
        </div>
      </header>
      ${
        rows.length
          ? `<div class="cluster-list">${rows
              .map(
                (row) => `
                  <div class="cluster-row">
                    <span class="cluster-count">${row.count}</span>
                    ${barMarkup(row.count, rows[0].count)}
                    <code class="ipa ${row.value === "∅" ? "cluster-empty" : ""}">${esc(row.value)}</code>
                  </div>`
              )
              .join("")}</div>`
          : `<div class="notice notice-quiet">${icon("sliders")}<p>No syllabified words yet.</p></div>`
      }
    </section>`;
}

function balancePanel(analysis) {
  const ratioText =
    analysis.ratio === null
      ? "—"
      : `${freq(analysis.ratio)} : 1 (${analysis.consonantTokens} C · ${analysis.vowelTokens} V)`;
  const voicedGaps = analysis.voicedWithoutVoiceless;
  const voicelessGaps = analysis.voicelessWithoutVoiced;
  const gapRows = analysis.gaps
    .slice(0, 8)
    .map(
      (gap) =>
        `<li><span class="gap-manner">${esc(gap.manner)}</span><span class="gap-missing">${gap.missing
          .map((place) => `<code>${esc(place)}</code>`)
          .join(" ")}<span class="muted"> lacking</span></span></li>`
    )
    .join("");
  return `
    <section class="panel analytics-panel">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Inventory balance</h2>
          <p>Token balance and symmetry gaps the charts and features already imply.</p>
        </div>
        <span class="panel-icon">${icon("sliders")}</span>
      </header>
      <div class="balance-list">
        <div class="balance-row">
          <span class="balance-label">Consonant / vowel tokens</span>
          <span>${esc(ratioText)}</span>
        </div>
        <div class="balance-row">
          <span class="balance-label">Charted inventory</span>
          <span>${analysis.consonantCount} consonants · ${analysis.vowelCount} vowels</span>
        </div>
        ${
          voicedGaps.length
            ? `<div class="balance-row"><span class="balance-label">Voiced, no voiceless counterpart</span><span>${voicedGaps
                .map((sound) => `<code class="ipa">${esc(sound)}</code>`)
                .join(" ")}</span></div>`
            : ""
        }
        ${
          voicelessGaps.length
            ? `<div class="balance-row"><span class="balance-label">Voiceless, no voiced counterpart</span><span>${voicelessGaps
                .map((sound) => `<code class="ipa">${esc(sound)}</code>`)
                .join(" ")}</span></div>`
            : ""
        }
      </div>
      <div class="symmetry-block">
        <h3>Chart gaps</h3>
        ${
          gapRows
            ? `<ul class="symmetry-list">${gapRows}</ul>`
            : `<p class="muted analysis-empty">The consonant chart is either empty or fills every row–place cell — no manner is missing a place.</p>`
        }
      </div>
    </section>`;
}

function leakagePanel(analysis) {
  const rows = analysis.leaks
    .map(
      (leak) => `
        <div class="leak-row">
          <span class="leak-gloss">${esc(leak.gloss)}</span>
          <code class="ipa leak-form">${esc(formatPhonemic(leak.form))}</code>
          <span class="leak-symbols">${leak.symbols
            .map((symbol) => `<span class="status-chip status-differs seg-diff" title="Recorded in a phonemic form, but only the allophony rules produce it">${esc(symbol)}</span>`)
            .join(" ")}</span>
        </div>`
    )
    .join("");
  return `
    <section class="panel analytics-panel">
      <header class="panel-head">
        <div class="panel-title">
          <h2>Allophone leakage</h2>
          <p>Stored /phonemic/ forms containing a symbol only the allophony rules output — likely a surface form saved by mistake.</p>
        </div>
        <span class="panel-icon">${icon("eye")}</span>
      </header>
      ${
        !analysis.hasAllophony
          ? `<div class="notice notice-quiet">${icon("info")}<p>No allophony rules in this language, so there is nothing to leak.</p></div>`
          : rows
            ? `<div class="leak-list">${rows}</div>`
            : `<div class="notice notice-quiet">${icon("check")}<p>No leakage — every recorded symbol is charted, or never was an allophone output.</p></div>`
      }
    </section>`;
}

export function renderAnalytics(container, ctx) {
  const { language } = ctx;
  const analysis = analyzeLexicon(ctx.project, language);

  container.innerHTML = `
    <div class="workspace-stack">
      <section class="section-intro">
        <div>
          <p class="eyebrow">Analytics</p>
          <h2>Lexicon analytics</h2>
          <p class="section-copy">What the vocabulary and charts say about ${esc(language.name)}: distribution, balance, and consistency checks. Everything is derived live — nothing here is stored.</p>
        </div>
        <div class="inventory-summary">
          ${summaryChip("words", analysis.words)}
          ${summaryChip("recorded", analysis.recorded)}
          ${summaryChip("tokens", analysis.tokenTotal)}
          ${summaryChip("charted", analysis.chartedCount)}
        </div>
      </section>
      <div class="analytics-main">
        ${frequencyPanel(analysis)}
        <div class="analytics-two">
          ${clusterPanel(
            "Onsets",
            analysis.onsets,
            "From the phonotactics syllabifier (maximal onset); ∅ marks no onset."
          )}
          ${clusterPanel(
            "Codas",
            analysis.codas,
            "From the same syllabified parses; ∅ marks no coda."
          )}
        </div>
        ${balancePanel(analysis)}
        ${leakagePanel(analysis)}
      </div>
    </div>
  `;
}

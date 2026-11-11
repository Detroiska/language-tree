// Secondary tool groups inside the long language tabs. Tool ids are part of
// the URL hash, so keep them stable: the default tool is omitted from the hash
// and an unknown tool falls back to it.
export const LANGUAGE_TOOLS = {
  changes: {
    label: "Sound change tools",
    defaultTool: "rules",
    tools: [
      {
        id: "rules",
        label: "Rules",
        hint: "Write top-level and sequential changes; test and check them below.",
      },
      {
        id: "test",
        label: "Test",
        hint: "Apply the current rules to an ancestral form and inspect each step.",
      },
      {
        id: "reconstruct",
        label: "Reconstruct",
        hint: "Invert the rules to propose the ancestral form.",
      },
      {
        id: "check",
        label: "Check",
        hint: "Compare every inherited gloss with the derived reflex.",
      },
    ],
  },
  phonotactics: {
    label: "Phonotactics tools",
    defaultTool: "template",
    tools: [
      {
        id: "template",
        label: "Template",
        hint: "Set the syllable template and try a form without touching the lexicon.",
      },
      {
        id: "categories",
        label: "Categories",
        hint: "Define the named sound groups used by templates and rules.",
      },
      {
        id: "constraints",
        label: "Constraints",
        hint: "Allow or forbid onsets, codas, and sequences across the word.",
      },
      {
        id: "stress",
        label: "Stress",
        hint: "Choose where primary stress falls and mark it in the lexicon.",
      },
      {
        id: "check",
        label: "Check",
        hint: "Check every recorded form against the inventory and template.",
      },
    ],
  },
  phonology: {
    label: "Phonology tools",
    defaultTool: "inventory",
    tools: [
      {
        id: "inventory",
        label: "Inventory",
        hint: "Lay out the contrastive consonants and vowels on their charts.",
      },
      {
        id: "features",
        label: "Features",
        hint: "Inspect and override the distinctive-feature bundles for charted sounds.",
      },
      {
        id: "allophones",
        label: "Allophones",
        hint: "See the phoneme-to-surface mapping produced by the allophony rules.",
      },
    ],
  },
  allophony: {
    label: "Allophony tools",
    defaultTool: "rules",
    tools: [
      {
        id: "rules",
        label: "Rules",
        hint: "Write and order the synchronic surface rules.",
      },
      {
        id: "test",
        label: "Test",
        hint: "Apply the allophony rules to a phonemic form and inspect each step.",
      },
    ],
  },
};

export function toolsForTab(tab) {
  return LANGUAGE_TOOLS[tab]?.tools || [];
}

export function defaultToolForTab(tab) {
  return LANGUAGE_TOOLS[tab]?.defaultTool || "";
}

export function normalizeTool(tab, tool) {
  const group = LANGUAGE_TOOLS[tab];
  if (!group) return "";
  return group.tools.some((item) => item.id === tool) ? tool : group.defaultTool;
}

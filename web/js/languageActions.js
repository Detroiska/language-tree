// Language creation and renaming shared by the language tab, the family tree,
// and the sidebar. Each action takes the same small context the views receive
// (`project`, `touch`, `refresh`, `navigate`) so it can run from any screen.
import { createAncestor, createLanguage, createSibling } from "./model.js";
import { languageHref } from "./routes.js";
import { promptDialog, toast } from "./ui.js";

export async function addRootLanguage(ctx) {
  if (!ctx.project) return;
  const name = await promptDialog({
    title: "Add a root language",
    label: "Name of the root language",
    value: "Proto-Language",
    placeholder: "e.g. Proto-North",
    confirmLabel: "Create language",
    help: "A root has no ancestor and starts with the default consonant and vowel charts.",
  });
  if (!name) return;
  const language = createLanguage(name, null);
  ctx.project.languages.push(language);
  ctx.touch({ label: `Add language ${language.name}` });
  ctx.refresh();
  ctx.navigate(languageHref(language));
  toast(`Created root language ${language.name}.`, { type: "success" });
}

export async function addAncestor(ctx, language) {
  const name = await promptDialog({
    title: "Add an ancestor language",
    label: `Name of the language ancestral to ${language.name}`,
    value: `Proto-${language.name}`,
    placeholder: "e.g. Proto-Coastal",
    confirmLabel: "Create ancestor",
    help: `${language.name} becomes its daughter. Its chart starts as a copy of ${language.name}, so you can work backwards from a descendant.`,
  });
  if (!name) return;
  const ancestor = createAncestor(ctx.project, language.id, name);
  if (!ancestor) return;
  ctx.touch({ label: `Add language ${ancestor.name}` });
  ctx.refresh();
  ctx.navigate(languageHref(ancestor));
  toast(`Created ${ancestor.name} above ${language.name}.`, { type: "success" });
}

export async function addSibling(ctx, language) {
  const siblingOf = language.parentId ? "sister language" : "sibling root language";
  const name = await promptDialog({
    title: `Add a ${siblingOf}`,
    label: `Name of the new language beside ${language.name}`,
    value: `${language.name} sister`,
    placeholder: "e.g. Old Inland",
    confirmLabel: "Create language",
    help: `It shares ${language.name}'s parent and starts with a copy of its chart.`,
  });
  if (!name) return;
  const sibling = createSibling(ctx.project, language.id, name);
  if (!sibling) return;
  ctx.touch({ label: `Add language ${sibling.name}` });
  ctx.refresh();
  ctx.navigate(languageHref(sibling));
  toast(`Created ${sibling.name} beside ${language.name}.`, { type: "success" });
}

export async function renameLanguage(ctx, language) {
  const name = await promptDialog({
    title: "Rename language",
    label: "Language name",
    value: language.name,
    confirmLabel: "Rename",
  });
  if (!name || name === language.name) return;
  language.name = name;
  ctx.touch({ label: "Rename language" });
  ctx.refresh();
}

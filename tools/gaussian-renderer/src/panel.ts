// side panel of the viewer: controls built from code, so that their options can come from the presets

export interface Choice {
  value: string;
  label: string;
}

// adds "label + drop-down menu" to the panel; onChange receives the chosen value. returns the menu
export function addSelect(
  panel: HTMLElement,
  label: string,
  choices: Choice[],
  value: string,
  onChange: (value: string) => void
): HTMLSelectElement {
  const row = document.createElement("label");
  row.className = "row";
  row.append(label);
  const select = document.createElement("select");
  for (const c of choices) {
    const option = document.createElement("option");
    option.value = c.value;
    option.textContent = c.label;
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  row.append(select);
  panel.append(row);
  return select;
}
export function showVlcHotkeys(list) {
  const shortcuts = [
    ["Alt+F", "Toggle affect arrows. While on, VLC arrow shortcuts are reserved."],
    ["Left / Right", "Decrease / increase valence."],
    ["Down / Up", "Decrease / increase arousal."],
    ["Alt+G / Alt+Shift+G", "Next / previous: Flubber, 2D grid, affective face morph map."],
    ["Ctrl+Shift+1 / 2 / 3", "Select Flubber / grid / face directly."],
    ["Ctrl+Alt+1 / 2 / 3", "Show or hide each feedback layer."],
    ["Ctrl+Alt+arrows", "Move the main feedback."],
    ["Ctrl+Alt+= / -", "Increase / decrease feedback size."],
    ["Ctrl+Alt+[ / ]", "Decrease / increase affect step."],
    ["Ctrl+Alt+, / .", "Slower / faster face transitions."],
    ["Ctrl+Alt+PageUp / PageDown", "Increase / decrease grid density."],
    ["Ctrl+Shift+PageUp / PageDown", "Increase / decrease panel height."],
    ["Ctrl+Shift+S", "Open detailed Flubber settings."],
    ["Escape", "Release mouse rating capture."],
  ];
  for (const [keys, action] of shortcuts) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = keys;
    description.textContent = action;
    list.append(term, description);
  }
}

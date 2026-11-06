import { showVlcHotkeys } from "./vlc-hotkeys.js";
import { mountTextFitting } from "./text-fit.js";
showVlcHotkeys(document.getElementById("vlc-hotkeys"));
await mountTextFitting();

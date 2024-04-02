("use strict");
console.log("This is a popup that shows on clicking the extension!");

import * as win from "./js/window.js";

let defaultWindowSize = {
  width: 500,
  height: 370,
};

function getUid() {
  return "type_to_calculate_" + Math.random().toString(36).slice(-8);
}

async function createNewDocument() {
  let id = getUid();
  await win.newWindow(id, defaultWindowSize.width, defaultWindowSize.height);
  console.log("created new window - - - with id: ", id);
  // await new Promise((resolve) => setTimeout(resolve, 30000));
  window.close();
}

createNewDocument();

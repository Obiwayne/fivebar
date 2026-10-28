const db = require("./db");

async function findUser(email) {
  return db.query(`SELECT * FROM users WHERE email = '${email}'`);
}

function render(el, html) {
  el.innerHTML = html;
}

function run(code) {
  return eval(code);
}

module.exports = { findUser, render, run };

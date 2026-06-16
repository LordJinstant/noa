// hash-password.js
const bcrypt = require('bcrypt');

bcrypt.hash("LordNoNeedPa55w0rd", 10).then(hash => {
  console.log("Copy this to .env:");
  console.log(hash);
});
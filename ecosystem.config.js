module.exports = {
  apps: [{
    name: "bud3",
    script: "./dist/main.js",
    instances: 1,
    exec_mode: "fork",
    autorestart: false,
    env: {
      NODE_ENV: "production"
    }
  }]
}

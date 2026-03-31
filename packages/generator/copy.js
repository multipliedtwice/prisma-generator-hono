const fs = require('fs')
const path = require('path')

const sourceReadme = path.resolve(__dirname, '../../README.md')
const sourceLicense = path.resolve(__dirname, '../../LICENSE')
const destinationPath = __dirname

function copyFile(source, dest) {
  const filename = path.basename(source)
  const target = path.join(dest, filename)
  if (!fs.existsSync(source)) {
    console.error(`Required file not found: ${source}`)
    process.exit(1)
  }
  fs.copyFileSync(source, target)
  console.log(`Copied ${filename}`)
}

copyFile(sourceReadme, destinationPath)
copyFile(sourceLicense, destinationPath)
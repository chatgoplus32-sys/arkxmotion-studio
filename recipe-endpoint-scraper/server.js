const express = require('express')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = 3001

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const sitesConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'sites.json'), 'utf8')
)

app.get('/api/sites', (_req, res) => {
  const sites = Object.entries(sitesConfig).map(([domain, cfg]) => ({
    domain,
    name: cfg.name,
    baseUrl: cfg.base_url,
    recipePatterns: cfg.recipe_patterns?.length || 0,
    endpointPatterns: cfg.endpoint_patterns?.length || 0,
    categories: cfg.categories ? Object.entries(cfg.categories).map(([key, cat]) => ({
      key,
      label: cat.label,
      pages: Object.keys(cat.pages),
    })) : [],
  }))
  res.json({ ok: true, sites })
})

app.post('/api/scrape', (req, res) => {
  const { target, allPages = false, jsBundles = false, category = null } = req.body

  if (!target) {
    return res.status(400).json({ ok: false, error: 'target is required' })
  }

  const args = ['scraper.py', target, '--quiet']
  if (allPages) args.push('--all-pages')
  if (jsBundles) args.push('--js-bundles')
  if (category) args.push('--category', category)

  console.log(`[scrape] ${target} category=${category || 'none'} args=${args.join(' ')}`)

  const proc = spawn('python', args, {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let killed = false

  proc.stdout.on('data', (data) => { stdout += data.toString() })
  proc.stderr.on('data', (data) => { stderr += data.toString() })

  const timer = setTimeout(() => {
    killed = true
    proc.kill('SIGTERM')
  }, 180000)

  proc.on('close', (code) => {
    clearTimeout(timer)
    if (killed) {
      console.log(`[scrape] timeout for ${target}`)
      return res.json({ ok: false, error: 'Scrape timed out (180s). Try fewer pages.' })
    }
    if (code !== 0 && !stdout) {
      console.log(`[scrape] error code=${code}: ${stderr.slice(0, 200)}`)
      return res.json({ ok: false, error: stderr || `Process exited with code ${code}` })
    }
    try {
      const data = JSON.parse(stdout)
      console.log(`[scrape] ok results=${data.length}`)
      res.json({ ok: true, results: data })
    } catch (e) {
      console.log(`[scrape] parse error: ${e.message}`)
      res.json({ ok: false, error: 'Failed to parse scraper output', raw: stdout.slice(0, 500) })
    }
  })

  proc.on('error', (err) => {
    clearTimeout(timer)
    console.log(`[scrape] spawn error: ${err.message}`)
    res.json({ ok: false, error: err.message })
  })
})

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
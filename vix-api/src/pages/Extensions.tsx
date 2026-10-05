import { useState } from 'react'
import { Badge, Icon, Segmented, Switch } from '../components/ui'
import { useApp } from '../lib/store'
import { t } from '../lib/i18n'
import { EXTENSIONS } from '../../shared/extensions.js'

export function ExtensionsPage() {
  const { settings, setExtension, toast } = useApp()
  const [scope, setScope] = useState<'editor' | 'api'>('editor')
  const [q, setQ] = useState('')
  const list = EXTENSIONS.filter((e) => e.scope === scope && (!q || `${e.name} ${e.description} ${e.category}`.toLowerCase().includes(q.toLowerCase())))
  const categories = [...new Set(list.map((e) => e.category))]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('ext.title')}</h1>
          <p className="hint">Editor extensions change your workspace and follow your account to every device. API extensions are switched on per API from its <strong>Extensions</strong> tab.</p>
        </div>
      </div>
      <div className="toolbar">
        <Segmented label="Extension type" value={scope} onChange={setScope} options={[{ value: 'editor', label: 'Editor & workspace' }, { value: 'api', label: 'API runtime' }]} />
        <label className="search-box">
          <Icon name="search" size={16} />
          <span className="sr-only">{t('common.search')}</span>
          <input type="search" placeholder="Search extensions" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {categories.map((cat) => (
        <section key={cat} aria-labelledby={`cat-${cat}`}>
          <h2 id={`cat-${cat}`} className="section-title">{cat}</h2>
          <ul className="ext-grid">
            {list.filter((e) => e.category === cat).map((e) => (
              <li key={e.id} className="ext-card">
                <div className="ext-head">
                  <span className="ext-icon" aria-hidden="true">{e.icon}</span>
                  <h3>{e.name}</h3>
                  {e.recommended && <Badge tone="accent">Recommended</Badge>}
                </div>
                <p>{e.description}</p>
                {scope === 'editor' ? (
                  <Switch
                    checked={!!settings.extensions[e.id]}
                    onChange={(v) => {
                      setExtension(e.id, v)
                      toast(`${e.name} ${v ? 'enabled' : 'disabled'}`, 'success')
                    }}
                    label={settings.extensions[e.id] ? 'Enabled' : 'Disabled'}
                  />
                ) : (
                  <p className="hint"><Icon name="info" size={14} /> Enable it inside an API → Extensions tab.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Textarea, Input, Label, EmptyState } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { getGensparkApiKey } from '@/lib/genspark'
import { secondBrainAction, type SecondBrainSource, type SecondBrainNote } from '@/lib/genspark-tools'
import { Brain, Search, FileText, RefreshCw, Loader2, ChevronRight, Mail, BookOpen, Calendar, MessageSquare } from 'lucide-react'

const SOURCE_ICONS: Record<string, any> = {
  memo: <FileText className="h-4 w-4" />,
  gmail: <Mail className="h-4 w-4" />,
  outlook: <Mail className="h-4 w-4" />,
  meeting: <Calendar className="h-4 w-4" />,
  notion: <BookOpen className="h-4 w-4" />,
}

export default function SecondBrainPage() {
  const addToast = useToastStore((s) => s.addToast)
  const [sources, setSources] = useState<SecondBrainSource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [selectedSource, setSelectedSource] = useState<string>('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any>(null)
  const [searching, setSearching] = useState(false)
  const [selectedNote, setSelectedNote] = useState<SecondBrainNote | null>(null)
  const [loadingNote, setLoadingNote] = useState(false)
  const [listingFiles, setListingFiles] = useState(false)
  const [listedFiles, setListedFiles] = useState<any>(null)

  const hasApiKey = !!getGensparkApiKey()

  useEffect(() => {
    if (hasApiKey) loadSources()
  }, [hasApiKey])

  const loadSources = async () => {
    setLoadingSources(true)
    try {
      const result = await secondBrainAction('list-repos')
      const data = result?.data || result
      if (data?.repos) {
        // Map repos to our source format
        setSources(data.repos.map((r: any) => ({
          name: r.source,
          type: r.source,
          repo_id: r.repo_id,
          last_sync: r.updated_at_iso,
        })))
      } else if (data?.sources) {
        setSources(data.sources)
      } else if (Array.isArray(data)) {
        setSources(data)
      }
    } catch (err: any) {
      console.error('[SecondBrain] Failed to load sources:', err)
      addToast(`Gagal load sources: ${err.message}`, 'error')
    } finally {
      setLoadingSources(false)
    }
  }

  const handleSearch = async () => {
    if (!query.trim()) return

    setSearching(true)
    setSearchResults(null)
    setSelectedNote(null)

    try {
      const result = await secondBrainAction('grep', {
        query: query.trim(),
        source: selectedSource || undefined,
        limit: 20,
      })
      setSearchResults(result?.data || result)
    } catch (err: any) {
      addToast(`Search gagal: ${err.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleListFiles = async (source: string) => {
    setListingFiles(true)
    setListedFiles(null)
    try {
      const result = await secondBrainAction('ls', { source })
      setListedFiles(result?.data || result)
    } catch (err: any) {
      addToast(`Gagal list files: ${err.message}`, 'error')
    } finally {
      setListingFiles(false)
    }
  }

  const handleReadNote = async (filePath: string, source?: string) => {
    setLoadingNote(true)
    try {
      const result = await secondBrainAction('read', {
        path: filePath,
        source: source || selectedSource || undefined,
      })
      setSelectedNote({
        path: filePath,
        content: result?.data?.content || result?.content || JSON.stringify(result, null, 2),
        source,
      })
    } catch (err: any) {
      addToast(`Gagal baca note: ${err.message}`, 'error')
    } finally {
      setLoadingNote(false)
    }
  }

  if (!hasApiKey) {
    return (
      <PageContent>
        <PageHeader
          eyebrow="Tools"
          title="Second"
          highlight="Brain"
          desc="Knowledge management — cari dan akses semua catatan, email, meeting notes."
        />
        <EmptyState
          icon={<Brain className="h-12 w-12" />}
          title="Belum ada Genspark API Key"
          description="Tambahkan Genspark API key di Providers untuk menggunakan Second Brain."
          action={
            <Button onClick={() => window.location.href = '/providers'}>
              Buka Providers
            </Button>
          }
        />
      </PageContent>
    )
  }

  return (
    <PageContent>
      <PageHeader
        eyebrow="Tools"
        title="Second"
        highlight="Brain"
        desc="Knowledge management — cari dan akses semua catatan, email, meeting notes dari Genspark."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Sources & Search */}
        <div className="space-y-4">
          <Section title="📚 Sources" sub="Sumber data yang terhubung">
            <div className="space-y-2">
              <button
                onClick={() => setSelectedSource('')}
                className={`w-full p-3 rounded-lg border text-left transition-all ${
                  !selectedSource
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  <span className="text-sm font-medium">Semua Sources</span>
                </div>
              </button>

              {loadingSources ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : sources.length > 0 ? (
                sources.map((source, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedSource(source.name)}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      selectedSource === source.name
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {SOURCE_ICONS[source.type] || <FileText className="h-4 w-4" />}
                        <span className="text-sm font-medium">{source.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{source.type}</span>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Tidak ada sources. Connect email/calendar di Genspark AI.
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={loadSources}
                disabled={loadingSources}
                className="w-full"
              >
                <RefreshCw className={`h-3 w-3 mr-2 ${loadingSources ? 'animate-spin' : ''}`} />
                Refresh Sources
              </Button>

              {selectedSource && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleListFiles(selectedSource)}
                  disabled={listingFiles}
                  className="w-full"
                >
                  {listingFiles ? (
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-3 w-3 mr-2" />
                  )}
                  List Files in {selectedSource}
                </Button>
              )}
            </div>
          </Section>

          <Section title="🔍 Search" sub="Cari di semua knowledge">
            <div className="space-y-3">
              <div>
                <Label>Query</Label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari catatan, email, meeting..."
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="w-full"
              >
                {searching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Search
                  </>
                )}
              </Button>
            </div>
          </Section>
        </div>

        {/* Center: Search Results & Files */}
        <div className="space-y-4">
          {listedFiles && (
            <Section title="📁 Files" sub={`Files in ${selectedSource}`}>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {Array.isArray(listedFiles) ? (
                  listedFiles.map((file: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleReadNote(file.path || file.name || file, selectedSource)}
                      className="w-full p-2 rounded-lg border border-border hover:border-primary/30 text-left transition-all text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3" />
                        <span className="truncate">{file.name || file.path || file}</span>
                      </div>
                    </button>
                  ))
                ) : listedFiles.entries ? (
                  listedFiles.entries.map((file: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleReadNote(file.path || file.name, selectedSource)}
                      className="w-full p-2 rounded-lg border border-border hover:border-primary/30 text-left transition-all text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3" />
                        <span className="truncate">{file.name || file.path}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <pre className="text-xs whitespace-pre-wrap p-2 bg-muted/50 rounded max-h-[200px] overflow-y-auto">
                    {JSON.stringify(listedFiles, null, 2).slice(0, 2000)}
                  </pre>
                )}
              </div>
            </Section>
          )}

          <Section title="📋 Results" sub="Hasil pencarian">
            {searchResults ? (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {Array.isArray(searchResults) ? (
                  searchResults.map((item: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleReadNote(item.path || item.id, item.source)}
                      className="w-full p-3 rounded-lg border border-border hover:border-primary/30 text-left transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {SOURCE_ICONS[item.source] || <FileText className="h-4 w-4" />}
                          <span className="text-sm font-medium truncate">
                            {item.title || item.path || `Note ${idx + 1}`}
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      {item.preview && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.preview}
                        </p>
                      )}
                    </button>
                  ))
                ) : searchResults.results ? (
                  searchResults.results.map((item: any, idx: number) => (
                    <button
                      key={idx}
                      onClick={() => handleReadNote(item.path || item.id, item.source)}
                      className="w-full p-3 rounded-lg border border-border hover:border-primary/30 text-left transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">
                          {item.title || item.path || `Result ${idx + 1}`}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))
                ) : (
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {JSON.stringify(searchResults, null, 2).slice(0, 2000)}
                  </pre>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="h-12 w-12 mb-4 opacity-50" />
                <p>Belum ada hasil</p>
                <p className="text-xs mt-1">Masukkan query lalu klik Search</p>
              </div>
            )}
          </Section>
        </div>

        {/* Right: Note Detail */}
        <div className="space-y-4">
          <Section title="📄 Detail" sub="Isi catatan">
            {selectedNote ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  {SOURCE_ICONS[selectedNote.source || ''] || <FileText className="h-4 w-4" />}
                  <span className="font-medium">{selectedNote.path}</span>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 border border-border max-h-[500px] overflow-y-auto">
                  {loadingNote ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {selectedNote.content}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FileText className="h-12 w-12 mb-4 opacity-50" />
                <p>Pilih note dari hasil pencarian</p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}

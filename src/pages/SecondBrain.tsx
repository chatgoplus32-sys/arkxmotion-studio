import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Input, Label, EmptyState, OptionCard } from '@/components/ui'
import { useToastStore } from '@/stores/toastStore'
import { getGensparkApiKey } from '@/lib/genspark'
import { secondBrainAction, type SecondBrainSource, type SecondBrainNote } from '@/lib/genspark-tools'
import { Brain, Search, FileText, RefreshCw, Loader2, ChevronRight, Mail, BookOpen, Calendar, FolderOpen, ListTree, ScanSearch, NotebookPen } from 'lucide-react'

const SOURCE_ICONS: Record<string, any> = {
  memo: <FileText className="h-4 w-4" />,
  gmail: <Mail className="h-4 w-4" />,
  outlook: <Mail className="h-4 w-4" />,
  meeting: <Calendar className="h-4 w-4" />,
  notion: <BookOpen className="h-4 w-4" />,
}

export default function SecondBrainPage() {
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()
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

  const loadSources = useCallback(async () => {
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
  }, [addToast])

  useEffect(() => {
    if (hasApiKey) loadSources()
  }, [hasApiKey, loadSources])

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
            <Button onClick={() => navigate('/providers')}>
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
        <div className="space-y-6">
          <Section title="Sources" icon={<BookOpen className="h-4 w-4" />} sub="Sumber data yang terhubung">
            <div className="space-y-2">
              <OptionCard
                title="Semua Sources"
                icon={<Brain className="h-4 w-4" />}
                selected={!selectedSource}
                onClick={() => setSelectedSource('')}
              />

              {loadingSources ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : sources.length > 0 ? (
                sources.map((source, idx) => (
                  <OptionCard
                    key={idx}
                    title={source.name}
                    description={source.type}
                    icon={SOURCE_ICONS[source.type] || <FileText className="h-4 w-4" />}
                    selected={selectedSource === source.name}
                    onClick={() => setSelectedSource(source.name)}
                  />
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

          <Section title="Search" icon={<ScanSearch className="h-4 w-4" />} sub="Cari di semua knowledge" delay={60}>
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
        <div className="space-y-6">
          {listedFiles && (
            <Section title="Files" icon={<FolderOpen className="h-4 w-4" />} sub={`Files in ${selectedSource}`} delay={60}>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {Array.isArray(listedFiles) ? (
                  listedFiles.map((file: any, idx: number) => (
                    <OptionCard
                      key={idx}
                      className="p-2.5"
                      title={<span className="truncate block">{file.name || file.path || file}</span>}
                      icon={<FileText className="h-3 w-3" />}
                      onClick={() => handleReadNote(file.path || file.name || file, selectedSource)}
                    />
                  ))
                ) : listedFiles.entries ? (
                  listedFiles.entries.map((file: any, idx: number) => (
                    <OptionCard
                      key={idx}
                      className="p-2.5"
                      title={<span className="truncate block">{file.name || file.path}</span>}
                      icon={<FileText className="h-3 w-3" />}
                      onClick={() => handleReadNote(file.path || file.name, selectedSource)}
                    />
                  ))
                ) : (
                  <pre className="text-xs whitespace-pre-wrap p-2 bg-muted/50 rounded max-h-[200px] overflow-y-auto">
                    {JSON.stringify(listedFiles, null, 2).slice(0, 2000)}
                  </pre>
                )}
              </div>
            </Section>
          )}

          <Section title="Results" icon={<ListTree className="h-4 w-4" />} sub="Hasil pencarian" delay={60}>
            {searchResults ? (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {Array.isArray(searchResults) ? (
                  searchResults.map((item: any, idx: number) => (
                    <OptionCard
                      key={idx}
                      title={item.title || item.path || `Note ${idx + 1}`}
                      description={item.preview}
                      icon={SOURCE_ICONS[item.source] || <FileText className="h-4 w-4" />}
                      trailing={<ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      onClick={() => handleReadNote(item.path || item.id, item.source)}
                    />
                  ))
                ) : searchResults.results ? (
                  searchResults.results.map((item: any, idx: number) => (
                    <OptionCard
                      key={idx}
                      title={item.title || item.path || `Result ${idx + 1}`}
                      trailing={<ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      onClick={() => handleReadNote(item.path || item.id, item.source)}
                    />
                  ))
                ) : (
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {JSON.stringify(searchResults, null, 2).slice(0, 2000)}
                  </pre>
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Search className="h-12 w-12" />}
                title="Belum ada hasil"
                description="Masukkan query lalu klik Search"
              />
            )}
          </Section>
        </div>

        {/* Right: Note Detail */}
        <div className="space-y-6">
          <Section title="Detail" icon={<NotebookPen className="h-4 w-4" />} sub="Isi catatan" delay={120}>
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
              <EmptyState
                icon={<FileText className="h-12 w-12" />}
                title="Pilih note dari hasil pencarian"
              />
            )}
          </Section>
        </div>
      </div>
    </PageContent>
  )
}

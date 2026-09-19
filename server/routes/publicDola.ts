import { Router, Request, Response } from 'express'

const router = Router()

const DOLA_BASE = 'https://www.dola.com'
const DOLA_QUERY = 'version_code=20800&language=id&device_platform=web&doubao_device_platform=web&aid=495671&real_aid=495671&pkg_type=release_version&device_id=7686340114943985205&pc_version=3.36.11&doubao_pc_version=3.36.11&web_id=7667246589015180801&tea_uuid=7667246589015180801&region=ID&sys_region=ID&samantha_web=1&web_platform=browser&use-olympus-account=1'

// Parse cookies from curl command or raw string
function parseCookies(input: string): string {
  const bMatch = input.match(/-b\s+['"](.+?)['"]/s)
  if (bMatch) return bMatch[1].trim()
  const cookieMatch = input.match(/--cookie\s+['"](.+?)['"]/s)
  if (cookieMatch) return cookieMatch[1].trim()
  if (input.includes('curl ') || input.includes('--url ')) {
    if (input.trim().startsWith('curl ')) return ''
  }
  return input.trim()
}

function makeHeaders(cookies: string) {
  const clean = parseCookies(cookies).replace(/\r\n/g, '; ').replace(/\n/g, '; ').replace(/\s+/g, ' ').trim()
  return {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'agw-js-conv': 'str',
    'content-type': 'application/json; encoding=utf-8',
    'origin': 'https://www.dola.com',
    'priority': 'u=1, i',
    'referer': 'https://www.dola.com/chat',
    'sec-ch-ua': '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Cookie': clean,
  }
}

function dolaUrl(path: string) {
  const tabId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return DOLA_BASE + path + '?' + DOLA_QUERY + '&web_tab_id=' + tabId
}

function genUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

async function dolaFetch(path: string, body: any, cookies: string) {
  const url = dolaUrl(path)
  const headers = makeHeaders(cookies)
  console.log('[dola] POST', path)
  console.log('[dola] cookies length:', headers.Cookie.length)

  const apiRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log('[dola] response', apiRes.status, rawText.slice(0, 500))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
  return data
}

// POST /api/dola/conversations
router.post('/conversations', async (req: Request, res: Response) => {
  try {
    const { cookies } = req.body
    if (!cookies) return res.json({ ok: false, error: 'Missing cookies' })

    const data = await dolaFetch('/im/chain/recent_conv', {
      cmd: 3200,
      uplink_body: {
        pull_recent_conv_chain_uplink_body: {
          limit: 20,
          message_count_per_conv: 0,
          api_version: 1,
          conv_version: 0,
          direction: 3,
          option: {
            not_need_message: true,
            need_complete_conversation: true,
            need_coco_bot: true,
            need_pc_pin_chain: true,
            pc_pin_query_type: 0,
            exclude_archive: true,
            only_archive: false,
          },
        },
      },
      sequence_id: genUUID(),
      channel: 2,
      version: '1',
      allow_free_queue: true,
      accept_queue: true,
      credits: 1,
      cost: 1,
    }, cookies)

    // Try multiple response structures
    const convList = data?.data?.conv_list
      || data?.uplink_body?.pull_recent_conv_chain_downlink_body?.conv_list
      || data?.conv_list
      || []

    console.log('[dola] found', convList.length, 'conversations')

    const conversations = convList.map((c: any) => ({
      conv_id: c.conv_id || c.chain_id || c.id || '',
      title: c.title || c.name || c.display_name || 'Untitled',
      updated_at: c.updated_at || c.update_time || Date.now(),
    }))

    return res.json({ ok: true, conversations, raw_code: data?.code })
  } catch (err: any) {
    console.error('[dola] conversations error:', err.message)
    return res.json({ ok: false, error: err.message })
  }
})

// POST /api/dola/chat — Send message
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { cookies, convId, message } = req.body
    if (!cookies) return res.json({ ok: false, error: 'Missing cookies' })
    if (!message) return res.json({ ok: false, error: 'Missing message' })

    console.log('[dola] chat send:', message.slice(0, 100), 'convId:', convId)

    const data = await dolaFetch('/im/chain/send_message', {
      cmd: 1000,
      uplink_body: {
        send_message_chain_uplink_body: {
          content: message,
          content_type: 1,
          conv_id: convId || '',
          msg_type: 'text',
        },
      },
      sequence_id: genUUID(),
      channel: 2,
      version: '1',
      allow_free_queue: true,
      accept_queue: true,
      credits: 1,
      cost: 1,
      no_watermark: true,
      remove_logo: true,
      quality: 'max',
    }, cookies)

    // Try to find reply in various structures
    const reply = data?.data?.reply
      || data?.uplink_body?.send_message_chain_downlink_body?.message?.content
      || data?.uplink_body?.reply_message?.content
      || data?.data?.message?.content
      || data?.reply
      || ''

    const newConvId = data?.data?.conv_id
      || data?.uplink_body?.send_message_chain_downlink_body?.conv_id
      || convId
      || ''

    console.log('[dola] reply length:', reply.length, 'convId:', newConvId)

    // If no immediate reply, try to poll for the AI response
    if (!reply && newConvId) {
      console.log('[dola] no immediate reply, polling...')
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const pollData = await dolaFetch('/im/chain/pull_message', {
          cmd: 3200,
          uplink_body: {
            pull_message_chain_uplink_body: {
              conv_id: newConvId,
              limit: 10,
              direction: 1,
              api_version: 1,
            },
          },
          sequence_id: genUUID(),
          channel: 2,
          version: '1',
        }, cookies)

        const msgList = pollData?.data?.message_list
          || pollData?.uplink_body?.pull_message_chain_downlink_body?.message_list
          || []

        // Find the latest assistant message
        const assistantMsgs = msgList.filter((m: any) => m.role === 2 || m.sender_type === 'bot')
        if (assistantMsgs.length > 0) {
          const latest = assistantMsgs[assistantMsgs.length - 1]
          const content = latest.content || latest.text || ''
          if (content) {
            console.log('[dola] got reply from poll:', content.slice(0, 100))
            return res.json({ ok: true, reply: content, conv_id: newConvId })
          }
        }
      }
    }

    return res.json({ ok: true, reply, conv_id: newConvId, raw: data })
  } catch (err: any) {
    console.error('[dola] chat error:', err.message)
    return res.json({ ok: false, error: err.message })
  }
})

// POST /api/dola/conversation/:convId/messages
router.post('/conversation/:convId/messages', async (req: Request, res: Response) => {
  try {
    const { cookies } = req.body
    const { convId } = req.params
    if (!cookies) return res.json({ ok: false, error: 'Missing cookies' })

    const data = await dolaFetch('/im/chain/pull_message', {
      cmd: 3200,
      uplink_body: {
        pull_message_chain_uplink_body: {
          conv_id: convId,
          limit: 50,
          direction: 1,
          api_version: 1,
        },
      },
      sequence_id: genUUID(),
      channel: 2,
      version: '1',
    }, cookies)

    const msgList = data?.data?.message_list
      || data?.uplink_body?.pull_message_chain_downlink_body?.message_list
      || []

    const messages = msgList.map((m: any) => ({
      role: m.role === 2 ? 'assistant' : m.role === 1 ? 'user' : 'system',
      content: m.content || m.text || '',
      message_id: m.message_id || m.id,
      timestamp: m.timestamp || m.create_time,
    })).filter((m: any) => m.content)

    return res.json({ ok: true, messages })
  } catch (err: any) {
    console.error('[dola] messages error:', err.message)
    return res.json({ ok: false, error: err.message })
  }
})

export default router

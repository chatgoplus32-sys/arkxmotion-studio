const ROBONEO_BASE = '/roboneo'
const CATBOX_API = 'https://catbox.moe/user/api.php'

export interface RoboneoConfig {
  accessToken: string
  clientId: string
}

function randomHex(len = 16) {
  return Array.from({ length: len }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
}

function generateGnum() {
  const a = randomHex(16)
  return `${a}-${randomHex(12)}-${randomHex(8)}-${randomHex(7)}-${randomHex(17)}`
}

function generateClientId() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000))
}

function generateRoomId(clientId: string) {
  const ts = Date.now()
  const hex = randomHex(32)
  const encId = btoa(clientId).replace(/=/g, '')
  return `${encId}-${hex}-${ts}`
}

export async function uploadToCatbox(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('reqtype', 'fileupload')
  formData.append('fileToUpload', file)

  const res = await fetch('/catbox', {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Catbox upload failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const url = (await res.text()).trim()
  if (!url.startsWith('http')) {
    throw new Error(`Catbox returned invalid URL: ${url}`)
  }

  return url
}

function buildWorkflowCanvas(params: {
  imageUrl: string
  videoUrl: string
  prompt: string
  apiName: string
  quality: string
}) {
  const { imageUrl, videoUrl, prompt, apiName, quality } = params

  const imageNodeId = randomHex(20)
  const videoNodeId = randomHex(20)
  const editNodeId = randomHex(20)

  const defaultPrompt = prompt || 'Refer to the movements and facial expressions in the reference video to animate photos without changing the original background.'

  const nodes = [
    {
      id: imageNodeId,
      type: 'IMAGE_NODE',
      meta: { position: { x: -240, y: 207 } },
      data: {
        name: 'Image 1',
        title: 'Image',
        isCustomer: true,
        isRecommend: true,
        status: 'loaded',
        media_list: [{
          url: imageUrl,
          originUrl: imageUrl,
          watermark_url: imageUrl,
          width: 941,
          height: 1672,
          name: 'Image',
          source: 'upload',
        }],
        mcpInfo: {
          api_name: 'image_praline_create_v2',
          model_id: 'mt_nano_pro',
          node_model_id: 'txt2img',
          parameters: {
            count: 1,
            prompt: '',
            ratio: '16:9',
            resolution: '2K',
          },
        },
      },
    },
    {
      id: videoNodeId,
      type: 'VIDEO_NODE',
      meta: { position: { x: -240, y: 487 } },
      data: {
        name: 'Video 2',
        title: 'Video',
        isCustomer: true,
        isRecommend: true,
        media_list: [{
          url: videoUrl,
          width: 1232,
          height: 1680,
          duration: 16,
          cover_url: `${videoUrl}?vframe/jpg/offset/0`,
          watermark_url: videoUrl,
          watermark_cover_url: `${videoUrl}?vframe/jpg/offset/0`,
        }],
        mcpInfo: {
          api_name: 'video_toffee_t2v_v20',
          model_id: 'seedance_2.0',
          node_model_id: 'txt2vid',
          parameters: {
            count: 1,
            prompt: '',
            ratio: '16:9',
            resolution: '720p',
            sound: 'true',
            video_duration: 5,
          },
        },
      },
    },
    {
      id: editNodeId,
      type: 'VIDEO_NODE',
      meta: { position: { x: 120, y: 347 } },
      data: {
        media_list: [],
        name: 'Video 1',
        mcpInfo: {
          api_name: apiName,
          model_id: 'kling_2_6_motion',
          node_model_id: 'video_edit',
          parameters: {
            count: 1,
            prompt: `Refer to the movements and facial expressions in [@input_video:${videoNodeId}] to animate photos without changing the original background. ${defaultPrompt}`,
            quality,
          },
        },
        isCustomer: false,
        isRecommend: false,
        inputNodeId: {
          textNodeIds: [],
          imageNodeIds: [imageNodeId],
          videoNodeIds: [videoNodeId],
          audioNodeIds: [],
        },
      },
    },
  ]

  const edges = [
    {
      sourceNodeID: imageNodeId,
      targetNodeID: editNodeId,
      sourcePortID: 'output',
      targetPortID: 'input',
    },
    {
      sourceNodeID: videoNodeId,
      targetNodeID: editNodeId,
      sourcePortID: 'output',
      targetPortID: 'input',
    },
  ]

  return { nodes, edges }
}

export async function submitMotionControlWorkflow(
  config: RoboneoConfig,
  params: {
    imageUrl: string
    videoUrl: string
    prompt?: string
    apiName?: string
    quality?: string
    roomId: string
  }
): Promise<{ gnum: string; roomId: string }> {
  const {
    imageUrl,
    videoUrl,
    prompt = '',
    apiName = 'video_bonbon_motioncontrol_v26',
    quality = 'std',
    roomId,
  } = params

  const gnum = generateGnum()

  const canvas = buildWorkflowCanvas({
    imageUrl,
    videoUrl,
    prompt,
    apiName,
    quality,
  })

  const body = {
    gnum,
    client_id: config.clientId,
    client_language: 'en',
    country_code: 'ID',
    room_id: roomId,
    data: JSON.stringify(canvas),
  }

  const res = await fetch(`${ROBONEO_BASE}/workflow/canvas/save.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access-token': config.accessToken,
      'client-id': config.clientId,
      'Origin': 'https://www.roboneo.com',
      'Referer': 'https://www.roboneo.com/',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Submit failed (${res.status}): ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  return { gnum, roomId }
}

export async function pollWorkflowStatus(
  config: RoboneoConfig,
  gnum: string,
  roomId: string
): Promise<{ status: string; url?: string }> {
  const res = await fetch(
    `${ROBONEO_BASE}/workflow/canvas/get.json?gnum=${encodeURIComponent(gnum)}&room_id=${encodeURIComponent(roomId)}`,
    {
      headers: {
        'access-token': config.accessToken,
        'client-id': config.clientId,
        'Origin': 'https://www.roboneo.com',
        'Referer': 'https://www.roboneo.com/',
      },
    }
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Poll failed (${res.status}): ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  const json = typeof data.data === 'string' ? JSON.parse(data.data) : data.data || data
  const nodes = json?.nodes || []

  const editNode = nodes.find((n: any) =>
    n.type === 'VIDEO_NODE' && n.data?.mcpInfo?.api_name?.includes('motioncontrol')
  )

  const outputMedia = editNode?.data?.media_list
  if (outputMedia?.length > 0 && outputMedia[0].url) {
    return { status: 'completed', url: outputMedia[0].url }
  }

  if (editNode?.data?.mcpInfo?.parameters?.task_id) {
    return { status: 'processing' }
  }

  return { status: 'processing' }
}

export async function waitForWorkflow(
  config: RoboneoConfig,
  gnum: string,
  roomId: string,
  onProgress?: (status: string, pct: number) => void,
  maxPolls = 120,
  pollInterval = 5000
): Promise<string> {
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollInterval))

    const result = await pollWorkflowStatus(config, gnum, roomId)
    const pct = Math.min(90, 10 + (i / maxPolls) * 80)

    onProgress?.(result.status, pct)

    if (result.status === 'completed' && result.url) {
      return result.url
    }
  }

  throw new Error('Timeout: generation took too long')
}

export function parseAccessToken(raw: string): RoboneoConfig {
  const token = raw.trim()
  const clientIdMatch = token.match(/(\d{10,})/)
  return {
    accessToken: token,
    clientId: clientIdMatch?.[1] || '1189857647',
  }
}

import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { join, tempDir } from "@tauri-apps/api/path"
import { writeFile, mkdir, readFile } from "@tauri-apps/plugin-fs"

interface SendImagesRequest {
  token: string
  channel_id: string
  image_paths: string[]
  nitro_mode: boolean
  send_separately: boolean
}

interface SendImagesResponse {
  success: boolean
  message_ids: string[]
  skipped: string[]
  errors: string[]
}

interface GuildInfo {
  id: string
  name: string
  icon: string | null
  channels: ChannelInfo[]
}

interface ChannelInfo {
  id: string
  name: string
  channel_type: string
}

interface ChannelData {
  channel_id: string
  channel_name: string
  guild_name: string
}

class App {
  private tokenInput: HTMLInputElement
  private nitroModeCheckbox: HTMLInputElement
  private sendSeparatelyCheckbox: HTMLInputElement
  private selectFilesBtn: HTMLButtonElement
  private sendBtn: HTMLButtonElement
  private saveTokenBtn: HTMLButtonElement
  private clearTokenBtn: HTMLButtonElement
  private selectedFilesDiv: HTMLElement
  private sendSection: HTMLElement
  private statusSection: HTMLElement
  private statusTitle: HTMLElement
  private statusContent: HTMLElement
  private dropZone: HTMLElement
  private channelBrowserSection: HTMLElement
  private browseChannelsBtn: HTMLButtonElement
  private changeChannelBtn: HTMLButtonElement
  private selectedChannelDisplay: HTMLElement
  private selectedChannelText: HTMLElement
  private channelModal: HTMLElement
  private closeModalBtn: HTMLButtonElement
  private guildsContainer: HTMLElement
  private objectUrls: string[] = []
  private selectedFiles: string[] = []
  private currentToken = ""
  private currentChannelId = ""
  private currentChannelName = ""
  private currentGuildName = ""
  private pastedImageCounter = 0

  constructor() {
    this.tokenInput = document.getElementById("token-input") as HTMLInputElement
    this.nitroModeCheckbox = document.getElementById("nitro-mode") as HTMLInputElement
    this.sendSeparatelyCheckbox = document.getElementById("send-separately") as HTMLInputElement
    this.selectFilesBtn = document.getElementById("select-files-btn") as HTMLButtonElement
    this.sendBtn = document.getElementById("send-btn") as HTMLButtonElement
    this.saveTokenBtn = document.getElementById("save-token-btn") as HTMLButtonElement
    this.clearTokenBtn = document.getElementById("clear-token-btn") as HTMLButtonElement
    this.selectedFilesDiv = document.getElementById("selected-files") as HTMLElement
    this.sendSection = document.getElementById("send-section") as HTMLElement
    this.statusSection = document.getElementById("status-section") as HTMLElement
    this.statusTitle = document.getElementById("status-title") as HTMLElement
    this.statusContent = document.getElementById("status-content") as HTMLElement
    this.dropZone = document.getElementById("drop-zone") as HTMLElement
    this.channelBrowserSection = document.getElementById("channel-browser-section") as HTMLElement
    this.browseChannelsBtn = document.getElementById("browse-channels-btn") as HTMLButtonElement
    this.changeChannelBtn = document.getElementById("change-channel-btn") as HTMLButtonElement
    this.selectedChannelDisplay = document.getElementById("selected-channel-display") as HTMLElement
    this.selectedChannelText = document.getElementById("selected-channel-text") as HTMLElement
    this.channelModal = document.getElementById("channel-modal") as HTMLElement
    this.closeModalBtn = document.getElementById("close-modal-btn") as HTMLButtonElement
    this.guildsContainer = document.getElementById("guilds-container") as HTMLElement

    this.init()
  }

  private async init() {
    await this.loadSavedToken()
    await this.loadSavedChannel()
    this.attachEventListeners()
    this.setupTauriDragAndDrop()
    this.setupPasteHandler()
  }

  private attachEventListeners() {
    this.saveTokenBtn.addEventListener("click", () => this.saveToken())
    this.clearTokenBtn.addEventListener("click", () => this.clearToken())
    this.selectFilesBtn.addEventListener("click", () => this.selectFiles())
    this.sendBtn.addEventListener("click", () => this.sendImages())
    this.browseChannelsBtn.addEventListener("click", () => this.openChannelBrowser())
    this.changeChannelBtn.addEventListener("click", () => this.openChannelBrowser())
    this.closeModalBtn.addEventListener("click", () => this.closeChannelBrowser())

    this.channelModal.addEventListener("click", (e) => {
      if (e.target === this.channelModal) {
        this.closeChannelBrowser()
      }
    })
  }

  private setupPasteHandler() {
    document.addEventListener("paste", async (e) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return
      }

      const items = e.clipboardData?.items
      if (!items) return

      const imageItems: DataTransferItem[] = []
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          imageItems.push(items[i])
        }
      }

      if (imageItems.length === 0) {
        return
      }

      e.preventDefault()

      const pastedFiles: File[] = []
      for (const item of imageItems) {
        const blob = item.getAsFile()
        if (blob) {
          pastedFiles.push(blob)
        }
      }

      // Process all pasted images
      for (const blob of pastedFiles) {
        await this.handlePastedImage(blob)
      }

      // Update UI after all images are processed
      this.renderSelectedFiles()
      this.sendSection.style.display = "block"

      if (pastedFiles.length > 1) {
        this.showStatus(`Pasted ${pastedFiles.length} images`, "success")
      }
    })
  }

  private async handlePastedImage(blob: File) {
    try {
      let extension = "png"
      if (blob.type === "image/jpeg") {
        extension = "jpg"
      } else if (blob.type === "image/png") {
        extension = "png"
      } else if (blob.type === "image/gif") {
        extension = "gif"
      } else if (blob.type === "image/webp") {
        extension = "webp"
      }

      // Use original filename if available, otherwise generate one
      let filename: string
      if (blob.name && blob.name !== "image.png" && blob.name !== "blob") {
        // Use original filename
        filename = blob.name
      } else {
        // Generate a filename if original name is not available or generic
        this.pastedImageCounter++
        const timestamp = Date.now()
        filename = `pasted-image-${timestamp}-${this.pastedImageCounter}.${extension}`
      }

      const tempDirPath = await tempDir()
      const appTempDir = await join(tempDirPath, "senddisimages")

      try {
        await mkdir(appTempDir, { recursive: true })
      } catch (error) {
        // Directory might already exist, ignore error
      }

      const filePath = await join(appTempDir, filename)

      const arrayBuffer = await blob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)

      await writeFile(filePath, uint8Array)

      this.selectedFiles.push(filePath)
      
      // Only show individual status for single images (batch message shown in setupPasteHandler)
      if (this.selectedFiles.length === 1) {
        this.showStatus(`Pasted image added: ${filename}`, "success")
      }
    } catch (error) {
      console.error("Failed to handle pasted image:", error)
      this.showStatus(`Failed to paste image: ${error}`, "error")
    }
  }

  private setupTauriDragAndDrop() {
    const webview = getCurrentWebviewWindow()

    webview.onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths
        await this.handleDroppedFiles(paths)
      } else if (event.payload.type === "enter") {
        this.dropZone.classList.add("drag-over")
      } else if (event.payload.type === "leave") {
        this.dropZone.classList.remove("drag-over")
      }
    })
  }

  private async handleDroppedFiles(paths: string[]) {
    this.dropZone.classList.remove("drag-over")

    const validExtensions = ["png", "jpg", "jpeg"]
    const validPaths: string[] = []

    for (const path of paths) {
      const ext = path.split(".").pop()?.toLowerCase()
      if (ext && validExtensions.includes(ext)) {
        validPaths.push(path)
      }
    }

    if (validPaths.length > 0) {
      this.selectedFiles = [...this.selectedFiles, ...validPaths]
      this.renderSelectedFiles()
      this.sendSection.style.display = "block"
      this.showStatus(`Added ${validPaths.length} image(s)`, "success")
    } else {
      this.showStatus("No valid image files found (PNG, JPG, JPEG only)", "error")
    }
  }

  private async loadSavedToken() {
    try {
      const token = await invoke<string | null>("load_token")
      if (token) {
        this.tokenInput.value = token
        this.currentToken = token
        this.channelBrowserSection.style.display = "block"
        this.showStatus("Token loaded from storage", "success")
      }
    } catch (error) {
      console.error("Failed to load token:", error)
    }
  }

  private async loadSavedChannel() {
    try {
      const channelData = await invoke<ChannelData | null>("load_channel")
      if (channelData) {
        this.currentChannelId = channelData.channel_id
        this.currentChannelName = channelData.channel_name
        this.currentGuildName = channelData.guild_name
        this.updateChannelDisplay()
      }
    } catch (error) {
      console.error("Failed to load channel:", error)
    }
  }

  private async saveToken() {
    const token = this.tokenInput.value.trim()
    if (!token) {
      this.showStatus("Please enter a token", "error")
      return
    }

    this.saveTokenBtn.disabled = true
    this.saveTokenBtn.innerHTML = '<span class="loading"></span> Validating...'

    try {
      const isValid = await invoke<boolean>("validate_token", { token })
      if (isValid) {
        await invoke("save_token", { token })
        this.currentToken = token
        this.channelBrowserSection.style.display = "block"
        this.showStatus("Token saved successfully!", "success")
      }
    } catch (error) {
      this.showStatus(`Failed to save token: ${error}`, "error")
    } finally {
      this.saveTokenBtn.disabled = false
      this.saveTokenBtn.innerHTML = "Save Token"
    }
  }

  private async clearToken() {
    try {
      await invoke("clear_token")
      this.tokenInput.value = ""
      this.currentToken = ""
      this.channelBrowserSection.style.display = "none"
      this.showStatus("Token cleared", "success")
    } catch (error) {
      this.showStatus(`Failed to clear token: ${error}`, "error")
    }
  }

  private async selectFiles() {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg"],
          },
        ],
      })

      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected]
        this.selectedFiles = files
        this.renderSelectedFiles()
        this.sendSection.style.display = "block"
      }
    } catch (error) {
      this.showStatus(`Failed to select files: ${error}`, "error")
    }
  }

  private async renderSelectedFiles() {
    if (this.selectedFiles.length === 0) {
    this.selectedFilesDiv.querySelectorAll(".remove-file").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const index = Number.parseInt((e.currentTarget as HTMLElement).dataset.index || "0")
        this.removeFile(index)
      })
    })
  }

    // Clear previous object URLs to prevent memory leaks
    this.cleanupObjectUrls()

    let html = ''
    
    for (let i = 0; i < this.selectedFiles.length; i++) {
      const file = this.selectedFiles[i]
      const fileName = file.split(/[\\/]/).pop() || file
      
      try {
        // Read the file as binary data
        const fileData = await readFile(file)
        
        // Create a blob and object URL
        const blob = new Blob([fileData])
        const objectUrl = URL.createObjectURL(blob)
        this.objectUrls.push(objectUrl)
        
        html += `
          <div class="file-item-preview">
            <div class="file-preview-header">
              <span class="file-name" title="${file}">${fileName}</span>
              <button class="remove-file" data-index="${i}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div class="file-preview-container">
              <img class="file-preview-image" src="${objectUrl}" alt="${fileName}" />
            </div>
          </div>
        `
      } catch (error) {
        console.error('Failed to load image preview:', error)
        // Fallback to placeholder if we can't read the file
        html += `
          <div class="file-item-preview">
            <div class="file-preview-header">
              <span class="file-name" title="${file}">${fileName}</span>
              <button class="remove-file" data-index="${i}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div class="file-preview-container">
              <div class="preview-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <p>${fileName}</p>
                <small>Failed to load preview</small>
              </div>
            </div>
          </div>
        `
      }
    }

    this.selectedFilesDiv.innerHTML = html

    this.selectedFilesDiv.querySelectorAll(".remove-file").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const index = Number.parseInt((e.currentTarget as HTMLElement).dataset.index || "0")
        this.selectedFiles.splice(index, 1)
        this.renderSelectedFiles()
      })
    })
  }

  private cleanupObjectUrls() {
    // Clean up previous object URLs to prevent memory leaks
    this.objectUrls.forEach(url => URL.revokeObjectURL(url))
    this.objectUrls = []
  }

  // Update the remove file handler to also clean up
  private async removeFile(index: number) {
    // Revoke the object URL for this file if it exists
    if (this.objectUrls[index]) {
      URL.revokeObjectURL(this.objectUrls[index])
      this.objectUrls.splice(index, 1)
    }
    this.selectedFiles.splice(index, 1)
    await this.renderSelectedFiles()
  }

  private async openChannelBrowser() {
    const token = this.currentToken || this.tokenInput.value.trim()

    if (!token) {
      this.showStatus("Please save a token first", "error")
      return
    }

    this.channelModal.style.display = "flex"
    this.guildsContainer.innerHTML = `
      <div class="loading-state">
        <span class="loading"></span>
        <p>Loading servers and channels...</p>
      </div>
    `

    try {
      const guilds = await invoke<GuildInfo[]>("get_guilds_and_channels", { token })

      if (guilds.length === 0) {
        this.guildsContainer.innerHTML = `
          <div class="empty-state">
            <p>No servers found. Make sure your bot is added to at least one server.</p>
          </div>
        `
        return
      }

      this.renderGuilds(guilds)
    } catch (error) {
      this.guildsContainer.innerHTML = `
        <div class="error-state">
          <p>Failed to load servers: ${error}</p>
        </div>
      `
    }
  }

  private renderGuilds(guilds: GuildInfo[]) {
    this.guildsContainer.innerHTML = guilds
      .map((guild) => {
        const textChannels = guild.channels.filter((c) => c.channel_type === "Text" || c.channel_type === "News")

        if (textChannels.length === 0) {
          return `
            <div class="guild-card">
              <div class="guild-header">
                <h3>${this.escapeHtml(guild.name)}</h3>
                <span class="channel-count">0 channels</span>
              </div>
              <p class="no-channels">No text channels available</p>
            </div>
          `
        }

        return `
          <div class="guild-card">
            <div class="guild-header">
              <h3>${this.escapeHtml(guild.name)}</h3>
              <span class="channel-count">${textChannels.length} channels</span>
            </div>
            <div class="channels-list">
              ${textChannels.map((channel) => `
                <button class="channel-item" 
                        data-channel-id="${channel.id}" 
                        data-channel-name="${this.escapeHtml(channel.name)}" 
                        data-guild-name="${this.escapeHtml(guild.name)}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  ${this.escapeHtml(channel.name)}
                </button>
              `).join('')}
            </div>
          </div>
        `
      })
      .join("")

    this.guildsContainer.querySelectorAll(".channel-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget as HTMLElement
        const channelId = target.dataset.channelId!
        const channelName = target.dataset.channelName!
        const guildName = target.dataset.guildName!
        this.selectChannel(channelId, channelName, guildName)
      })
    })
  }

  private async selectChannel(channelId: string, channelName: string, guildName: string) {
    this.currentChannelId = channelId
    this.currentChannelName = channelName
    this.currentGuildName = guildName

    try {
      await invoke("save_channel", {
        channelId,
        channelName,
        guildName,
      })
      this.updateChannelDisplay()
      this.closeChannelBrowser()
      this.showStatus(`Selected channel: ${guildName} > #${channelName}`, "success")
    } catch (error) {
      this.showStatus(`Failed to save channel: ${error}`, "error")
    }
  }

  private updateChannelDisplay() {
    if (this.currentChannelId) {
      this.selectedChannelText.textContent = `${this.currentGuildName} > #${this.currentChannelName}`
      this.selectedChannelDisplay.style.display = "block"
    } else {
      this.selectedChannelDisplay.style.display = "none"
    }
  }

  private closeChannelBrowser() {
    this.channelModal.style.display = "none"
  }

  private async sendImages() {
    const token = this.currentToken || this.tokenInput.value.trim()
    const channelId = this.currentChannelId

    if (!token) {
      this.showStatus("Please enter and save a Discord bot token", "error")
      return
    }

    if (!channelId) {
      this.showStatus("Please select a channel", "error")
      return
    }

    if (this.selectedFiles.length === 0) {
      this.showStatus("Please select at least one image", "error")
      return
    }

    this.sendBtn.disabled = true
    this.sendBtn.innerHTML = '<span class="loading"></span> Sending...'

    try {
      const request: SendImagesRequest = {
        token,
        channel_id: channelId,
        image_paths: this.selectedFiles,
        nitro_mode: this.nitroModeCheckbox.checked,
        send_separately: this.sendSeparatelyCheckbox.checked,
      }

      const response = await invoke<SendImagesResponse>("send_images", { request })

      this.displayResults(response)
    } catch (error) {
      this.showStatus(`Failed to send images: ${error}`, "error")
    } finally {
      this.sendBtn.disabled = false
      this.sendBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
        Send Images
      `
    }
  }

  private displayResults(response: SendImagesResponse) {
    let html = ""
    let statusClass = "success"

    if (response.success && response.message_ids.length > 0) {
      html += `<p class="status-success">✓ Successfully sent ${response.message_ids.length} message(s)</p>`
    }

    if (response.skipped.length > 0) {
      statusClass = "warning"
      html += '<p class="status-warning">⚠ Skipped files (too large):</p>'
      html += '<ul class="status-list">'
      response.skipped.forEach((item) => {
        html += `<li class="status-warning">${item}</li>`
      })
      html += "</ul>"
    }

    if (response.errors.length > 0) {
      statusClass = "error"
      html += '<p class="status-error">✗ Errors:</p>'
      html += '<ul class="status-list">'
      response.errors.forEach((item) => {
        html += `<li class="status-error">${item}</li>`
      })
      html += "</ul>"
    }

    if (!response.success && response.message_ids.length === 0) {
      statusClass = "error"
      html = '<p class="status-error">✗ No images were sent</p>' + html
    }

    this.statusSection.className = `card status-card ${statusClass}`
    this.statusTitle.textContent = response.success ? "Success!" : "Completed with issues"
    this.statusContent.innerHTML = html
    this.statusSection.style.display = "block"

    if (response.success) {
      this.selectedFiles = []
      this.renderSelectedFiles()
    }
  }

  private showStatus(message: string, type: "success" | "error" | "warning") {
    this.statusSection.className = `card status-card ${type}`
    this.statusTitle.textContent = type === "success" ? "Success" : type === "error" ? "Error" : "Warning"
    this.statusContent.innerHTML = `<p class="status-${type}">${message}</p>`
    this.statusSection.style.display = "block"

    setTimeout(() => {
      this.statusSection.style.display = "none"
    }, 5000)
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }
}

new App()
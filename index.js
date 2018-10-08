const TWO_PI = 2 * Math.PI

function play(audioContext, wave, stop = false) {
  if (stop) {
    this.source.stop()
    return
  }

  var channel = wave.channels
  var frame = wave.frames
  var buffer = audioContext.createBuffer(channel, frame, audioContext.sampleRate)

  for (var i = 0; i < wave.channels; ++i) {
    var waveFloat32 = new Float32Array(wave.data[i])
    buffer.copyToChannel(waveFloat32, i, 0)
  }

  if (this.source !== undefined) {
    this.source.stop()
  }
  this.source = audioContext.createBufferSource()
  this.source.buffer = buffer
  this.source.connect(audioContext.destination)
  this.source.start()
}

function save(wave) {
  var buffer = Wave.toBuffer(wave, wave.channels)
  var header = Wave.fileHeader(audioContext.sampleRate, wave.channels,
    buffer.length)

  var blob = new Blob([header, buffer], { type: "application/octet-stream" })
  var url = window.URL.createObjectURL(blob)

  var a = document.createElement("a")
  a.style = "display: none"
  a.href = url
  a.download = document.title + "_" + Date.now() + ".wav"
  document.body.appendChild(a)
  a.click()

  // Firefoxでダウンロードできるようにするための遅延。
  setTimeout(() => {
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }, 100)
}

function getChannels() {
  switch (pullDownMenuChannel.value) {
    case "Phase":
    case "Mono":
      return 1
    case "Stereo":
      return 2
  }
  return wave.channels
}

function makeWave() {
  headingRenderStatus.element.textContent = "⚠ Rendering ⚠"
  var channels = getChannels()
  for (var ch = 0; ch < channels; ++ch) {
    if (workers[ch].isRunning) {
      workers[ch].worker.terminate()
      workers[ch].worker = new Worker("renderer.js")
    }
    else {
      workers[ch].isRunning = true
    }
    workers[ch].worker.postMessage({
      sampleRate: audioContext.sampleRate,
      overSampling: checkboxResample.value ? 16 : 1,
      baseFreq: inputBaseFreq.value,
      bandWidth: inputBandWidth.value,
      seed: inputSeed.value + inputSeed.max * ch,
      overtone: overtoneControl.overtone,
    })
  }

  workers.forEach((value, index) => {
    value.worker.onmessage = (event) => {
      wave.data[index] = event.data
      workers[index].isRunning = false
      if (workers.every((v) => !v.isRunning)) {
        if (channels === 1) {
          wave.copyChannel(index)
          if (pullDownMenuChannel.value === "Phase" && wave.channels > 1) {
            wave.rotate(1, Math.floor(wave.data[1].length / 2))
          }
        }
        finalize()
      }
    }
  })
}

function finalize() {
  if (checkboxNormalize.value) {
    wave.normalize()
  }
  // wave.zeroOut(Math.floor(0.002 * audioContext.sampleRate))
  waveView.set(wave)

  if (checkboxQuickSave.value) {
    save(wave)
  }

  headingRenderStatus.element.textContent = "Rendering finished. ✓"
}

class WaveViewMulti {
  constructor(parent, channels) {
    this.waveView = []
    for (var i = 0; i < channels; ++i) {
      this.waveView.push(new WaveView(parent, 450, 256, wave.left, false))
    }
  }

  set(wave) {
    for (var ch = 0; ch < this.waveView.length; ++ch) {
      this.waveView[ch].set(wave.data[ch])
    }
  }
}

class OvertoneControl extends Canvas {
  constructor(parent, width, height, numOvertone, onChangeFunc) {
    super(parent, width, height)

    this.element.className = "overtoneControl"
    this.onChangeFunc = onChangeFunc

    numOvertone = Math.floor(Math.max(1, numOvertone))
    this.overtone = new Array(numOvertone).fill(0)
    this.overtone[0] = 1

    this.sliderWidth = width / numOvertone

    this.isMouseDown = false
    this.mouseX = null

    this.element.addEventListener("wheel", this, false)
    this.element.addEventListener("mousedown", this, false)
    this.element.addEventListener("mouseup", this, false)
    this.element.addEventListener("mousemove", this, false)
    this.element.addEventListener("mouseleave", this, false)
    this.element.addEventListener("touchstart", this, false)
    this.element.addEventListener("touchend", this, false)
    this.element.addEventListener("touchmove", this, false)

    this.draw()
  }

  setOvertone(overtone) {
    if (overtone.length !== this.overtone.length) {
      console.log("Overtone length mismatch")
      console.trace()
      return
    }

    var min = Number.MAX_VALUE
    var max = Number.MIN_VALUE
    for (var i = 0; i < overtone.length; ++i) {
      if (overtone[i] < min)
        min = overtone[i]
      else if (overtone[i] > max)
        max = overtone[i]
    }

    var diff = max - min
    for (var i = 0; i < this.overtone.length; ++i) {
      this.overtone[i] = (overtone[i] - min) / diff
    }

    this.draw()
  }

  handleEvent(event) {
    switch (event.type) {
      case "wheel":
        this.onWheel(event)
        break
      case "mousedown":
        this.onMouseDown(event)
        break
      case "mouseup":
        this.onMouseUp(event)
        break
      case "mousemove":
        this.onMouseMove(event)
        break
      case "mouseleave":
        this.onMouseLeave(event)
        break
      case "touchstart":
        this.onMouseDown(event)
        break
      case "touchend":
        this.onMouseUp(event)
        break
      case "touchmove":
        this.onMouseMove(event)
        break
    }
  }

  getMousePosition(event) {
    var point = event.type.includes("touch") ? event.touches[0] : event

    var rect = event.target.getBoundingClientRect()
    var x = Math.floor(point.clientX - rect.left)
    var y = event.ctrlKey ? this.height
      : event.altKey ? 0 : Math.floor(point.clientY - rect.top)
    return new Vec2(x, y)
  }

  onMouseDown(event) {
    this.isMouseDown = true

    this.setValueFromPosition(this.getMousePosition(event))
  }

  onMouseUp(event) {
    this.isMouseDown = false
    this.onChangeFunc()
  }

  onMouseMove(event) {
    var pos = this.getMousePosition(event)
    this.mouseX = pos.x

    if (this.isMouseDown)
      this.setValueFromPosition(pos)
    else
      this.draw()
  }

  onMouseLeave(event) {
    if (this.isMouseDown === true)
      this.onChangeFunc()

    this.isMouseDown = false
    this.mouseX = null
    this.draw()
  }

  onWheel(event) {
    event.preventDefault() // 画面のスクロールを阻止。

    var rect = event.target.getBoundingClientRect()
    var x = Math.floor(event.clientX - rect.left)
    var index = Math.floor(x / this.sliderWidth)

    if (event.ctrlKey) {
      this.setValue(index, this.overtone[index] - 0.001 * event.deltaY)
    }
    else {
      this.setValue(index, this.overtone[index] - 0.003 * event.deltaY)
    }

    this.draw()
    this.onChangeFunc()
  }

  setValue(index, value) {
    this.overtone[index] = Math.max(0, Math.min(value, 1))
  }

  setValueFromPosition(position) {
    var index = Math.floor(position.x / this.sliderWidth)
    var value = 1 - position.y / this.height

    this.setValue(index, value)
    this.draw()
  }

  draw() {
    this.clearWhite()

    var ctx = this.context

    ctx.fillStyle = "#88bbff"
    ctx.strokeStyle = "#333333"
    ctx.lineWidth = 2

    ctx.beginPath()
    for (var i = 0; i < this.overtone.length; ++i) {
      var sliderHeight = this.overtone[i] * this.height
      ctx.rect(
        i * this.sliderWidth,
        this.height - sliderHeight,
        this.sliderWidth,
        sliderHeight
      )
    }
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = "#000000"
    ctx.font = "8px monospace"
    for (var i = 0; i < this.overtone.length; ++i) {
      ctx.fillText((i + 1), i * this.sliderWidth + 2, this.height - 4)
    }

    if (this.mouseX !== null) {
      var index = Math.floor(this.overtone.length * this.mouseX / this.width)
      if (index >= 0 && index < this.overtone.length) {
        ctx.fillStyle = "#00ff0033"
        ctx.fillRect(index * this.sliderWidth, 0, this.sliderWidth, this.height)
      }
    }
  }
}

function refresh() {
  makeWave()
}

function randomRange(min, max) {
  return (max - min) * Math.random() + min
}

function randomRangeInt(min, max) {
  return Math.floor(randomRange(min, max + 1))
}

function random() {
  if (pullDownMenuRandomType.value === "Choir") {
    inputSeed.random()

    var overtone = new Array(overtoneControl.overtone.length)
    for (var i = 0; i < overtone.length; ++i) {
      overtone[i] = Math.random()
    }
    overtoneControl.setOvertone(overtone)
  }
  else {
    // "All" case.
    inputBaseFreq.random()
    inputBandWidth.random()
    inputSeed.random()

    var overtone = new Array(overtoneControl.overtone.length)
    for (var i = 0; i < overtone.length; ++i) {
      overtone[i] = Math.random()
    }
    overtoneControl.setOvertone(overtone)
  }
  refresh()
}


//-- UI.

var audioContext = new AudioContext()

var wave = new Wave(2)
var workers = []
for (var ch = 0; ch < wave.channels; ++ch) {
  workers.push({
    worker: new Worker("renderer.js"),
    isRunning: false,
  })
}

var divMain = new Div(document.body, "main")
var headingTitle = new Heading(divMain.element, 1, document.title)

var description = new Description(divMain.element)
description.add("基本操作", "Playボタンかキーボードのスペースキーで音を再生します。")
description.add("", "Stopボタンで音を停止できます。")
description.add("", "値を変更するかRandomボタンを押すと音がレンダリングされます。")
description.add("", "Randomボタンの隣のプルダウンメニューでランダマイズの種類を選択できます。")
description.add("", "Saveボタンで気に入った音を保存できます。")
description.add("", "QuickSaveにチェックを入れると音を再生するたびに音が保存されます。")

var divWaveform = new Div(divMain.element, "waveform")
var headingWaveform = new Heading(divWaveform.element, 6, "Waveform")
var waveView = new WaveViewMulti(divWaveform.element, wave.channels)

var divRenderControls = new Div(divMain.element, "renderControls")
var headingRenderStatus = new Heading(divRenderControls.element, 4,
  "Rendering status will be displayed here.")
var buttonStop = new Button(divRenderControls.element, "Stop",
  () => play(audioContext, wave, true))
var buttonPlay = new Button(divRenderControls.element, "Play",
  () => play(audioContext, wave))
var buttonRandom = new Button(divRenderControls.element, "Random",
  () => { random(); play(audioContext, wave, true) })
var pullDownMenuRandomType = new PullDownMenu(divRenderControls.element, null,
  () => { })
pullDownMenuRandomType.add("Choir")
pullDownMenuRandomType.add("All")
var buttonSave = new Button(divRenderControls.element, "Save",
  () => save(wave))
var checkboxQuickSave = new Checkbox(divRenderControls.element, "QuickSave",
  false, (checked) => { })

//// ControlLeft
var divControlLeft = new Div(divMain.element, "controlLeft", "controlBlock")

var divMiscControls = new Div(divControlLeft.element, "MiscControls")
var headingRender = new Heading(divMiscControls.element, 6, "Render Settings")
var pullDownMenuChannel = new PullDownMenu(divMiscControls.element, null,
  () => { refresh() })
pullDownMenuChannel.add("Phase")
pullDownMenuChannel.add("Mono")
pullDownMenuChannel.add("Stereo")
var checkboxNormalize = new Checkbox(divMiscControls.element, "Normalize",
  true, refresh)
var checkboxResample = new Checkbox(divMiscControls.element, "16x Sampling",
  false, refresh)

var divPadsynthControls = new Div(divControlLeft.element, "PadsynthControls")
var headingPadsynth = new Heading(divPadsynthControls.element, 6, "PADsynth")
var inputBaseFreq = new NumberInput(divPadsynthControls.element, "BaseFreq",
  220, 1, 1000, 0.01, refresh)
var inputBandWidth = new NumberInput(divPadsynthControls.element, "BandWidth",
  50, 0.01, 200, 0.01, refresh)
var inputSeed = new NumberInput(divPadsynthControls.element, "Seed",
  0, 0, Math.floor(Number.MAX_SAFE_INTEGER / 2), 1, refresh)

var divOvertoneControl = new Div(divControlLeft.element, "OvertoneControl")
var headingOvertone = new Heading(divOvertoneControl.element, 6, "Overtone")
var overtoneControl = new OvertoneControl(divOvertoneControl.element,
  448, 256, 32, refresh)

refresh()

window.addEventListener("keydown", (event) => {
  if (event.keyCode === 32) {
    play(audioContext, wave)
  }
})

// If startup is succeeded, remove "unsupported" paragaraph.
document.getElementById("unsupported").outerHTML = ""

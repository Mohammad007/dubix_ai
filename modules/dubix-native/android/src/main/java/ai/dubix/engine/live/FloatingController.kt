package ai.dubix.engine.live

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * Compact always-on-top controller drawn over other apps (requires "Display over other apps").
 * Flat DubiX palette; every control has a content description for TalkBack.
 * It controls only DubiX's own capture/translation; it cannot change other apps' audio.
 */
class FloatingController(
  private val context: Context,
  config: LiveSession.Config,
  private val actions: Actions
) {
  interface Actions {
    fun togglePause()
    fun setCaptions(on: Boolean)
    fun setSpeak(on: Boolean)
    fun close()
  }

  private val wm = context.getSystemService(WindowManager::class.java)
  private val density = context.resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()

  private var captions = config.captions
  private var speak = config.speak
  private var paused = false
  private var minimized = false

  private val params = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    // FLAG_SECURE keeps the controller (and its translated captions) out of screen capture, so the
    // on-screen subtitle reader never reads DubiX's own text.
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or WindowManager.LayoutParams.FLAG_SECURE,
    PixelFormat.TRANSLUCENT
  ).apply { gravity = Gravity.TOP or Gravity.START; x = dp(16); y = dp(120) }

  private val status = label("Listening", 12f, MUTED)
  private val caption = label("", 15f, TEXT).apply { maxLines = 3; visibility = View.GONE }
  private val pauseBtn = button("Pause") { paused = !paused; actions.togglePause(); refresh() }
  private val ccBtn = button("CC") { captions = !captions; actions.setCaptions(captions); refresh() }
  private val voiceBtn = button("Voice") { speak = !speak; actions.setSpeak(speak); refresh() }
  private val minBtn = button("–") { minimized = true; refresh() }.apply { contentDescription = "Minimize controller" }
  private val closeBtn = button("✕") { actions.close() }.apply { contentDescription = "Stop live translation" }

  private val panel = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(12), dp(10), dp(12), dp(12))
    background = rounded(NAVY, dp(16).toFloat(), BORDER)
    val header = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
      addView(label("⋮⋮", 14f, MUTED).apply { setPadding(0, 0, dp(8), 0); contentDescription = "Drag handle" })
      addView(LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        addView(label("DubiX AI", 14f, TEXT).apply { typeface = Typeface.DEFAULT_BOLD })
        addView(label("${config.sourceLang.uppercase()} → ${config.targetLang.uppercase()}", 12f, CYAN))
      }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      addView(minBtn); addView(closeBtn)
    }
    addView(header)
    addView(status)
    addView(LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(0, dp(8), 0, 0)
      addView(pauseBtn); addView(ccBtn); addView(voiceBtn)
    })
    addView(caption)
  }

  private val bubble = label("DX", 14f, Color.WHITE).apply {
    gravity = Gravity.CENTER
    typeface = Typeface.DEFAULT_BOLD
    background = rounded(CYAN, dp(28).toFloat(), CYAN)
    layoutParams = LinearLayout.LayoutParams(dp(56), dp(56))
    contentDescription = "DubiX controller. Tap to expand."
    setOnClickListener { minimized = false; refresh() }
  }

  private val root = LinearLayout(context).apply { addView(panel); addView(bubble) }

  @SuppressLint("ClickableViewAccessibility")
  fun show() {
    var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
    val drag = View.OnTouchListener { _, e ->
      when (e.action) {
        MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y; false }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX; val dy = e.rawY - downY
          if (abs(dx) > dp(6) || abs(dy) > dp(6)) {
            params.x = startX + dx.toInt(); params.y = startY + dy.toInt()
            runCatching { wm.updateViewLayout(root, params) }; true
          } else false
        }
        // consume the UP only after a drag, so a plain tap still reaches the view's click handler
        MotionEvent.ACTION_UP -> abs(e.rawX - downX) > dp(6) || abs(e.rawY - downY) > dp(6)
        else -> false
      }
    }
    panel.setOnTouchListener(drag)
    bubble.setOnTouchListener(drag)
    refresh()
    wm.addView(root, params)
  }

  fun hide() { runCatching { wm.removeView(root) } }

  fun setState(state: String, message: String?) {
    paused = state == "paused"
    status.text = when (state) {
      "listening" -> "Listening"
      "paused" -> "Paused"
      "capture_silent" -> "No capturable audio — the playing app may block capture"
      "screen_blocked" -> "This app blocks screen capture (protected video)"
      "no_subtitles" -> "No subtitles found — turn on subtitles in the app"
      "mic_silent" -> "Microphone is silent"
      "projection_stopped" -> "Capture permission ended"
      "error" -> message ?: "Error"
      else -> state
    }
    status.setTextColor(if (state in setOf("error", "capture_silent", "projection_stopped", "screen_blocked", "no_subtitles")) WARN else MUTED)
    refresh()
  }

  fun setCaption(text: String) { caption.text = text; refresh() }

  private fun refresh() {
    panel.visibility = if (minimized) View.GONE else View.VISIBLE
    bubble.visibility = if (minimized) View.VISIBLE else View.GONE
    pauseBtn.text = if (paused) "Resume" else "Pause"
    pauseBtn.contentDescription = if (paused) "Resume translation" else "Pause translation"
    style(ccBtn, captions); ccBtn.contentDescription = "Subtitles ${if (captions) "on" else "off"}"
    style(voiceBtn, speak); voiceBtn.contentDescription = "Translated voice ${if (speak) "on" else "off"}"
    style(pauseBtn, !paused)
    caption.visibility = if (captions && caption.text.isNotEmpty()) View.VISIBLE else View.GONE
  }

  private fun style(b: TextView, on: Boolean) {
    b.setTextColor(if (on) Color.WHITE else TEXT)
    b.background = rounded(if (on) CYAN else SURFACE, dp(10).toFloat(), if (on) CYAN else BORDER)
  }

  private fun label(text: String, size: Float, color: Int) = TextView(context).apply {
    this.text = text; textSize = size; setTextColor(color)
  }

  private fun button(text: String, onClick: () -> Unit) = TextView(context).apply {
    this.text = text; textSize = 14f; gravity = Gravity.CENTER
    minWidth = dp(48); minHeight = dp(44)
    setPadding(dp(12), 0, dp(12), 0)
    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(44)).apply { marginEnd = dp(8) }
    setOnClickListener { onClick() }
  }

  private fun rounded(fill: Int, radius: Float, stroke: Int) = GradientDrawable().apply {
    setColor(fill); cornerRadius = radius; setStroke(dp(1), stroke)
  }

  companion object {
    // DubiX light palette (flat): white panel, purple accent.
    val NAVY = Color.parseColor("#FFFFFF")      // panel background
    val SURFACE = Color.parseColor("#F0EEFF")   // idle button
    val BORDER = Color.parseColor("#E5E7EF")
    val CYAN = Color.parseColor("#6848F4")      // accent
    val MUTED = Color.parseColor("#667085")
    val WARN = Color.parseColor("#B45309")
    val TEXT = Color.parseColor("#111827")
  }
}

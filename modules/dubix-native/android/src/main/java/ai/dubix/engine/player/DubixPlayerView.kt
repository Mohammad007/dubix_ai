package ai.dubix.engine.player

import android.content.Context
import android.graphics.Color
import android.view.ViewGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** Video surface for a [PlayerManager] player. Controls and captions are drawn in React Native. */
@UnstableApi
class DubixPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val playerView = PlayerView(context).apply {
    useController = false
    setShutterBackgroundColor(Color.BLACK)
    setBackgroundColor(Color.BLACK)
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
  }

  init { addView(playerView) }

  fun setPlayerId(id: String?) {
    playerView.player = id?.let { PlayerManager.find(it)?.player }
  }

  fun setResizeMode(mode: String?) {
    playerView.resizeMode = when (mode) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun detach() { playerView.player = null }
}

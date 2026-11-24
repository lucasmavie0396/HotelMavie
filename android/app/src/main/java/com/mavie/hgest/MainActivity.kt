package com.mavie.hgest

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var config: Config
    private var web: WebView? = null
    private var aLigar = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = Config(this)
        arrancar()
    }

    override fun onDestroy() {
        web?.destroy()
        super.onDestroy()
    }

    override fun onRestart() {
        super.onRestart()
        if (aLigar) {
            aLigar = false
            arrancar()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && config.quarto) ecraInteiro()
    }

    private fun arrancar() {
        if (!config.configurado) {
            abrirLigacao()
            return
        }
        if (config.quarto) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val versao = Regex("Chrome/(\\d+)").find(WebSettings.getDefaultUserAgent(this))?.groupValues?.get(1)?.toIntOrNull() ?: 0
        if (versao in 1 until VERSAO_MINIMA) {
            mostrarMensagem("O Android System WebView deste aparelho é demasiado antigo (versão $versao). Atualize-o para a versão $VERSAO_MINIMA ou mais recente na Play Store.")
            return
        }
        mostrarMensagem("A ligar ao servidor…", botoes = false)
        thread {
            val responde = LigarActivity.responde(config.servidor, 4000)
            runOnUiThread {
                if (responde) abrirPagina()
                else mostrarMensagem("Não foi possível ligar ao servidor ${config.servidor}. Verifique a rede Wi-Fi do hotel.")
            }
        }
    }

    private fun abrirLigacao() {
        aLigar = true
        startActivity(Intent(this, LigarActivity::class.java))
    }

    @Suppress("DEPRECATION")
    private fun ecraInteiro() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun abrirPagina() {
        val origem = Uri.parse(config.servidor)
        val vista = web ?: WebView(this).also { web = it }
        vista.settings.javaScriptEnabled = true
        vista.settings.domStorageEnabled = true
        vista.settings.mediaPlaybackRequiresUserGesture = false
        CookieManager.getInstance().setAcceptCookie(true)
        vista.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = foraDoServidor(request.url)

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = foraDoServidor(Uri.parse(url))

            private fun foraDoServidor(url: Uri): Boolean {
                if (url.host == origem.host && url.port == origem.port) return false
                if (!config.quarto) runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) mostrarMensagem("A ligação ao servidor falhou. Verifique a rede Wi-Fi do hotel.")
            }

            @Deprecated("Deprecated in Java")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) mostrarMensagem("A ligação ao servidor falhou. Verifique a rede Wi-Fi do hotel.")
            }
        }
        setContentView(vista)
        if (config.quarto) ecraInteiro()
        vista.loadUrl(config.pagina())
    }

    private fun mostrarMensagem(texto: String, botoes: Boolean = true) {
        val painel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.WHITE)
        }
        painel.addView(TextView(this).apply { text = texto; textSize = 18f; gravity = Gravity.CENTER })
        if (botoes) painel.addView(Button(this).apply { text = "Tentar de novo"; setOnClickListener { arrancar() } })
        if (botoes) painel.addView(Button(this).apply { text = "Ligação ao servidor"; setOnClickListener { abrirLigacao() } })
        setContentView(painel)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val vista = web
        if (vista != null && vista.canGoBack()) {
            vista.goBack()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("MAVIE-HGest")
            .setItems(arrayOf("Ligação ao servidor", "Sair da app")) { _, escolha ->
                if (escolha == 0) abrirLigacao() else finish()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private companion object {
        const val VERSAO_MINIMA = 70
    }
}

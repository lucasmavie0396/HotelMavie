package com.mavie.hgest

import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class LigarActivity : ComponentActivity() {
    private lateinit var config: Config
    private lateinit var servidor: EditText
    private lateinit var modos: RadioGroup
    private lateinit var estado: TextView
    private lateinit var ligar: Button
    private val idPainel = 1
    private val idQuarto = 2

    private val leitor = registerForActivityResult(ScanContract()) { resultado ->
        val lido = resultado.contents ?: return@registerForActivityResult
        val uri = Uri.parse(lido)
        if (uri.scheme != "mavie") {
            estado.text = "Este QR code não é o de ligação do MAVIE-HGest."
            return@registerForActivityResult
        }
        servidor.setText(uri.getQueryParameter("servidor") ?: "")
        when (uri.getQueryParameter("modo")) {
            Config.MODO_QUARTO -> modos.check(idQuarto)
            Config.MODO_PAINEL -> modos.check(idPainel)
        }
        ligarAoServidor()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = Config(this)
        val painel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 64, 48, 48)
        }
        painel.addView(TextView(this).apply { text = "MAVIE-HGest"; textSize = 28f; gravity = Gravity.CENTER })
        painel.addView(TextView(this).apply {
            text = "No computador do hotel: Configuração → App Android → QR de ligação."
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 32)
        })
        painel.addView(Button(this).apply {
            text = "Ler QR code"
            setOnClickListener {
                leitor.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Aponte para o QR code de ligação").setBeepEnabled(false).setOrientationLocked(true))
            }
        })
        servidor = EditText(this).apply {
            hint = "Servidor (ex.: 192.168.1.10:3101)"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(config.servidor.removePrefix("http://"))
        }
        painel.addView(servidor)
        modos = RadioGroup(this).apply {
            setPadding(0, 16, 0, 16)
            addView(RadioButton(context).apply { id = idPainel; text = "Painel e ponto de venda (empregados)"; textSize = 16f })
            addView(RadioButton(context).apply { id = idQuarto; text = "Tablet do quarto (hóspedes)"; textSize = 16f })
            check(if (config.quarto) idQuarto else idPainel)
        }
        painel.addView(modos)
        ligar = Button(this).apply { text = "Ligar"; setOnClickListener { ligarAoServidor() } }
        painel.addView(ligar)
        estado = TextView(this).apply { textSize = 16f; gravity = Gravity.CENTER; setPadding(0, 24, 0, 0) }
        painel.addView(estado)
        setContentView(ScrollView(this).apply { addView(painel) })
    }

    private fun ligarAoServidor() {
        val endereco = Config.normalizar(servidor.text.toString())
        if (endereco.isEmpty()) {
            estado.text = "Indique o endereço do servidor."
            return
        }
        val modo = if (modos.checkedRadioButtonId == idQuarto) Config.MODO_QUARTO else Config.MODO_PAINEL
        ligar.isEnabled = false
        estado.text = "A ligar…"
        thread {
            val responde = responde(endereco)
            runOnUiThread {
                ligar.isEnabled = true
                if (responde) {
                    config.servidor = endereco
                    config.modo = modo
                    finish()
                } else {
                    estado.text = "Não foi possível contactar o servidor $endereco. Verifique o endereço e a rede Wi-Fi."
                }
            }
        }
    }

    companion object {
        fun responde(base: String, espera: Int = 6000): Boolean = runCatching {
            val ligacao = URL("$base/api/health").openConnection() as HttpURLConnection
            try {
                ligacao.connectTimeout = espera
                ligacao.readTimeout = espera
                ligacao.responseCode in 200..299
            } finally {
                ligacao.disconnect()
            }
        }.getOrDefault(false)
    }
}

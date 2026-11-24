package com.mavie.hgest

import android.content.Context

class Config(contexto: Context) {
    private val prefs = contexto.getSharedPreferences("mavie", Context.MODE_PRIVATE)

    var servidor: String
        get() = prefs.getString("servidor", "") ?: ""
        set(valor) = prefs.edit().putString("servidor", valor).apply()

    var modo: String
        get() = prefs.getString("modo", MODO_PAINEL) ?: MODO_PAINEL
        set(valor) = prefs.edit().putString("modo", valor).apply()

    val configurado: Boolean
        get() = servidor.isNotEmpty()

    val quarto: Boolean
        get() = modo == MODO_QUARTO

    fun pagina(): String = if (quarto) "$servidor/quarto" else "$servidor/"

    companion object {
        const val MODO_PAINEL = "painel"
        const val MODO_QUARTO = "quarto"

        fun normalizar(texto: String): String {
            val limpo = texto.trim().trimEnd('/')
            if (limpo.isEmpty()) return ""
            return if (limpo.startsWith("http://") || limpo.startsWith("https://")) limpo else "http://$limpo"
        }
    }
}

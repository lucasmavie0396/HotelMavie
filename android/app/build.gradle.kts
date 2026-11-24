plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ficheiroChave = System.getenv("ANDROID_KEYSTORE_FICHEIRO")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "com.mavie.hgest"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mavie.hgest"
        minSdk = 21
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    signingConfigs {
        if (ficheiroChave != null) {
            create("mavie") {
                storeFile = ficheiroChave
                storePassword = System.getenv("ANDROID_KEYSTORE_SENHA")
                keyAlias = System.getenv("ANDROID_KEYSTORE_ALIAS")
                keyPassword = System.getenv("ANDROID_KEYSTORE_SENHA")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ficheiroChave != null) signingConfigs.getByName("mavie") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}

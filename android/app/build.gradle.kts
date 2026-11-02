plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.gamja.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.gamja.app"
        minSdk = 26
        // 28로 고정: 29 이상을 대상으로 하면 앱이 내려받은 리눅스 프로그램(Ubuntu, Node, Claude Code)을
        // 실행할 수 없다 (Termux와 같은 이유). 홈페이지 직접 배포라 Play 스토어 요구 사항은 해당 없음.
        targetSdk = 28
        // 앱 번호는 "앱 코드(android/)를 고친 날짜 + 그날 몇 번째"로 CI가 계산해서 넘겨준다 (감자알 번호와 따로 간다).
        // 예) 2026-10-31 첫 번째 → code 2026103101, 보이는 이름 202.61.03101. 안드로이드는 code가 커져야 업데이트로 인정한다
        versionCode = System.getenv("GAMJA_APP_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("GAMJA_APP_NAME") ?: "0.0.1"
    }

    // 감자 서명 키: GitHub Secrets(GAMJA_KEYSTORE)에 보관한 고정 키로 서명해야 업데이트를 덮어 설치할 수 있다.
    // CI가 GAMJA_KEYSTORE_FILE에 키 파일 경로를, GAMJA_KEYSTORE_PASSWORD에 비밀번호를 넘겨준다 (둘 다 GitHub Secrets).
    // 키 파일이 없으면(내 컴퓨터 빌드 등) 기본 디버그 키로 서명한다. 키 파일은 있는데 비밀번호가 없으면 엉뚱한 키로 서명하지 않도록 멈춘다
    val gamjaKeystore = System.getenv("GAMJA_KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }
    val gamjaKeystorePassword = System.getenv("GAMJA_KEYSTORE_PASSWORD")?.takeIf { it.isNotEmpty() }
    if (gamjaKeystore != null && gamjaKeystorePassword == null) {
        throw GradleException("서명 키 파일은 있는데 GAMJA_KEYSTORE_PASSWORD가 없어요. GitHub Secrets를 확인하세요.")
    }
    signingConfigs {
        if (gamjaKeystore != null) create("gamja") {
            storeFile = gamjaKeystore
            storePassword = gamjaKeystorePassword
            keyAlias = "gamja"
            keyPassword = gamjaKeystorePassword
        }
    }

    buildTypes {
        debug {
            if (gamjaKeystore != null) signingConfig = signingConfigs.getByName("gamja")
        }
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        disable += "ExpiredTargetSdkVersion"
        abortOnError = false
    }
}

dependencies {
    // 공식 Claude Code 로그인 화면을 그대로 보여 주기 위한 터미널 화면 (Apache 2.0)
    implementation("com.github.termux.termux-app:terminal-view:v0.118.0")
    // Ubuntu와 감자 서버 압축 풀기 (Apache 2.0)
    implementation("org.apache.commons:commons-compress:1.26.2")
}

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io") // Termux 터미널 화면 라이브러리
    }
}
rootProject.name = "gamja"
include(":app")

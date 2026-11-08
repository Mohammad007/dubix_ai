# Consumer rules: merged into the app's release (R8) build.

# sherpa-onnx uses JNI field access on its Kotlin config classes.
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keep class ai.dubix.engine.** { *; }

# ML Kit / Firebase components instantiate registrars by reflection (no-arg constructor) from
# AndroidManifest metadata. R8 removed those constructors in release builds, so ML Kit never
# registered its translation components ("NoSuchMethodException: NaturalLanguageTranslateRegistrar.<init>")
# and every translation call failed with NullPointerExceptions. Keep registrars and ML Kit itself.
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_translate.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
-keep class com.google.firebase.components.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.internal.mlkit_**

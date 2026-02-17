// --- BLOC DE DIAGNOSTIC ADMIN ---
const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('id, role, nom, prenom')
  .eq('id', authData.user.id)
  .maybeSingle();

if (profileError) {
  console.error("❌ ERREUR SUPABASE :", profileError.message);
  console.error("CODE ERREUR :", profileError.code);
  console.error("DÉTAILS :", profileError.details);
}

if (!profile) {
  // Ce log est crucial pour comprendre ce que le serveur "voit" réellement
  const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
  
  console.error(`⛔ Profil introuvable pour l'UID: ${authData.user.id}`);
  console.error(`📊 Diagnostic : La table 'profiles' contient ${count ?? 0} lignes au total pour ce client.`);
  
  return res.status(403).json({ 
    error: "Profil introuvable",
    debug_code: profileError?.code || "NO_DATA",
    total_rows_visible: count 
  });
}
// --- FIN DU BLOC ---

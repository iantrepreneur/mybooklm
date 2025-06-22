import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    console.log('Callback de génération audio reçu:', body)
    
    const { notebook_id, audio_url, status, error } = body
    
    if (!notebook_id) {
      return new Response(
        JSON.stringify({ error: 'L\'ID du notebook est requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    if (status === 'success' && audio_url) {
      // Définir le temps d'expiration (24 heures à partir de maintenant)
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + 24)

      // Mettre à jour le notebook avec l'URL audio et le statut de succès
      const { error: updateError } = await supabase
        .from('notebooks')
        .update({
          audio_overview_url: audio_url,
          audio_url_expires_at: expiresAt.toISOString(),
          audio_overview_generation_status: 'completed'
        })
        .eq('id', notebook_id)

      if (updateError) {
        console.error('Erreur lors de la mise à jour du notebook avec l\'URL audio:', updateError)
        throw updateError
      }

      console.log('Aperçu audio complété avec succès pour le notebook:', notebook_id)
    } else {
      // Mettre à jour le notebook avec le statut d'échec
      const { error: updateError } = await supabase
        .from('notebooks')
        .update({
          audio_overview_generation_status: 'failed'
        })
        .eq('id', notebook_id)

      if (updateError) {
        console.error('Erreur lors de la mise à jour du statut du notebook en échec:', updateError)
        throw updateError
      }

      console.log('Génération audio échouée pour le notebook:', notebook_id, 'Erreur:', error)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Erreur dans audio-generation-callback:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Échec du traitement du callback' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
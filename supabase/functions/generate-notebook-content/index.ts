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
    const { notebookId, filePath, sourceType } = await req.json()

    if (!notebookId || !sourceType) {
      return new Response(
        JSON.stringify({ error: 'notebookId et sourceType sont requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Traitement de la demande:', { notebookId, filePath, sourceType });

    // Récupérer les variables d'environnement
    const webServiceUrl = Deno.env.get('NOTEBOOK_GENERATION_URL')
    const authHeader = Deno.env.get('NOTEBOOK_GENERATION_AUTH')

    if (!webServiceUrl || !authHeader) {
      console.error('Variables d\'environnement manquantes:', {
        hasUrl: !!webServiceUrl,
        hasAuth: !!authHeader,
        urlValue: webServiceUrl ? 'définie' : 'non définie',
        authValue: authHeader ? `définie (${authHeader.substring(0, 10)}...)` : 'non définie'
      })
      
      // Initialiser le client Supabase pour mettre à jour le statut
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      await supabaseClient
        .from('notebooks')
        .update({ generation_status: 'failed' })
        .eq('id', notebookId)
      
      return new Response(
        JSON.stringify({ error: 'Configuration du service web manquante' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialiser le client Supabase
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Mettre à jour le statut du notebook à 'generating'
    await supabaseClient
      .from('notebooks')
      .update({ generation_status: 'generating' })
      .eq('id', notebookId)

    console.log('Appel du service web externe...')
    console.log('Utilisation de l\'en-tête d\'authentification (10 premiers caractères):', authHeader.substring(0, 10) + '...');

    // Préparer le payload basé sur le type de source
    let payload: any = {
      sourceType: sourceType
    };

    if (filePath) {
      // Pour les sources de fichiers (PDF, audio) ou les URL (site web, YouTube)
      payload.filePath = filePath;
    } else {
      // Pour les sources textuelles, nous devons obtenir le contenu de la base de données
      const { data: source } = await supabaseClient
        .from('sources')
        .select('content')
        .eq('notebook_id', notebookId)
        .single();
      
      if (source?.content) {
        payload.content = source.content.substring(0, 5000); // Limiter la taille du contenu
      }
    }

    console.log('Envoi du payload au service web:', payload);

    // Appeler le service web externe
    const response = await fetch(webServiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      console.error('Erreur du service web:', response.status, response.statusText)
      const errorText = await response.text();
      console.error('Réponse d\'erreur:', errorText);
      
      // Mettre à jour le statut en échec
      await supabaseClient
        .from('notebooks')
        .update({ generation_status: 'failed' })
        .eq('id', notebookId)

      // Fournir des messages d'erreur plus spécifiques
      let errorMessage = 'Échec de la génération de contenu depuis le service web';
      if (response.status === 401 || response.status === 403) {
        errorMessage = 'Échec de l\'authentification - veuillez vérifier la configuration du webhook';
      } else if (response.status >= 500) {
        errorMessage = 'Erreur du service externe - veuillez réessayer plus tard';
      }

      return new Response(
        JSON.stringify({ 
          error: errorMessage,
          details: errorText,
          status: response.status 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const generatedData = await response.json()
    console.log('Données générées:', generatedData)

    // Analyser le format de réponse: objet avec propriété output
    let title, description, notebookIcon, backgroundColor, exampleQuestions;
    
    if (generatedData && generatedData.output) {
      const output = generatedData.output;
      title = output.title;
      description = output.summary;
      notebookIcon = output.notebook_icon;
      backgroundColor = output.background_color;
      exampleQuestions = output.example_questions || [];
    } else {
      console.error('Format de réponse inattendu:', generatedData)
      
      await supabaseClient
        .from('notebooks')
        .update({ generation_status: 'failed' })
        .eq('id', notebookId)

      return new Response(
        JSON.stringify({ error: 'Format de réponse invalide du service web' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!title) {
      console.error('Aucun titre retourné par le service web')
      
      await supabaseClient
        .from('notebooks')
        .update({ generation_status: 'failed' })
        .eq('id', notebookId)

      return new Response(
        JSON.stringify({ error: 'Aucun titre dans la réponse du service web' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mettre à jour le notebook avec le contenu généré, y compris l'icône, la couleur et les questions d'exemple
    const { error: notebookError } = await supabaseClient
      .from('notebooks')
      .update({
        title: title,
        description: description || null,
        icon: notebookIcon || '📝',
        color: backgroundColor || 'bg-gray-100',
        example_questions: exampleQuestions || [],
        generation_status: 'completed'
      })
      .eq('id', notebookId)

    if (notebookError) {
      console.error('Erreur de mise à jour du notebook:', notebookError)
      return new Response(
        JSON.stringify({ error: 'Échec de la mise à jour du notebook' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Notebook mis à jour avec succès avec les questions d\'exemple:', exampleQuestions)

    return new Response(
      JSON.stringify({ 
        success: true, 
        title, 
        description,
        icon: notebookIcon,
        color: backgroundColor,
        exampleQuestions,
        message: 'Contenu du notebook généré avec succès' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Erreur de fonction Edge:', error)
    
    // Essayer de mettre à jour le statut du notebook en échec si nous avons le notebookId
    try {
      const body = await req.json()
      if (body.notebookId) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
        
        await supabaseClient
          .from('notebooks')
          .update({ generation_status: 'failed' })
          .eq('id', body.notebookId)
      }
    } catch (updateError) {
      console.error('Échec de la mise à jour du statut du notebook:', updateError)
    }
    
    return new Response(
      JSON.stringify({ error: 'Erreur interne du serveur', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
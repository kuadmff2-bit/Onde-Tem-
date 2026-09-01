(()=>{
  const MAX_SOURCE_SIZE=15*1024*1024;
  const OUTPUT_WIDTH=1200;
  const OUTPUT_HEIGHT=900;
  const states=new Map();
  let active=null;

  const overlay=document.createElement('div');
  overlay.className='photo-editor-overlay';
  overlay.hidden=true;
  overlay.innerHTML=`
    <section class="photo-editor-card" role="dialog" aria-modal="true" aria-labelledby="photoEditorTitle">
      <header class="photo-editor-head">
        <div><strong id="photoEditorTitle">Editar foto</strong><small>Arraste a imagem e ajuste o zoom</small></div>
        <button type="button" class="photo-editor-close" aria-label="Fechar">×</button>
      </header>
      <div class="photo-editor-stage">
        <canvas width="800" height="600" aria-label="Área de recorte da imagem"></canvas>
        <span class="photo-editor-hint">Arraste para reposicionar</span>
      </div>
      <div class="photo-editor-controls">
        <div class="photo-zoom-row">
          <button type="button" data-zoom="out" aria-label="Diminuir zoom">−</button>
          <label>Zoom <input class="photo-zoom" type="range" min="1" max="3" value="1" step="0.01"></label>
          <button type="button" data-zoom="in" aria-label="Aumentar zoom">+</button>
        </div>
        <button type="button" class="photo-editor-reset">Centralizar</button>
      </div>
      <footer class="photo-editor-actions">
        <button type="button" class="photo-editor-cancel">Cancelar</button>
        <button type="button" class="photo-editor-save">Usar esta foto</button>
      </footer>
    </section>`;
  document.body.appendChild(overlay);

  const card=overlay.querySelector('.photo-editor-card');
  const canvas=overlay.querySelector('canvas');
  const ctx=canvas.getContext('2d',{alpha:false});
  const zoomInput=overlay.querySelector('.photo-zoom');
  const closeButton=overlay.querySelector('.photo-editor-close');
  const cancelButton=overlay.querySelector('.photo-editor-cancel');
  const saveButton=overlay.querySelector('.photo-editor-save');
  const resetButton=overlay.querySelector('.photo-editor-reset');

  function formatSize(bytes){
    if(bytes<1024*1024)return`${Math.max(1,Math.round(bytes/1024))} KB`;
    return`${(bytes/(1024*1024)).toFixed(1)} MB`;
  }

  function showToast(message){
    const toast=document.getElementById('toast');
    if(!toast)return alert(message);
    toast.textContent=message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer=setTimeout(()=>toast.classList.remove('show'),3200);
  }

  function assignFile(input,file){
    try{
      const dt=new DataTransfer();
      if(file)dt.items.add(file);
      input.files=dt.files;
    }catch(error){
      console.warn('Não foi possível atualizar input.files',error);
    }
  }

  function clearPreview(input){
    const state=states.get(input);
    if(state?.previewUrl)URL.revokeObjectURL(state.previewUrl);
    states.set(input,{file:null,previewUrl:null});
    assignFile(input,null);
    input.value='';
    const field=input.closest('.photo-field');
    if(!field)return;
    field.classList.remove('has-photo');
    const img=field.querySelector('.photo-preview-img');
    if(img)img.removeAttribute('src');
    const name=field.querySelector('.photo-selected-name');
    if(name)name.textContent='Nenhuma foto selecionada';
  }

  function setFinalFile(input,file){
    const previous=states.get(input);
    if(previous?.previewUrl)URL.revokeObjectURL(previous.previewUrl);
    const previewUrl=URL.createObjectURL(file);
    states.set(input,{file,previewUrl});
    assignFile(input,file);
    const field=input.closest('.photo-field');
    field?.classList.add('has-photo');
    const img=field?.querySelector('.photo-preview-img');
    if(img)img.src=previewUrl;
    const name=field?.querySelector('.photo-selected-name');
    if(name)name.textContent=`${file.name} • ${formatSize(file.size)}`;
  }

  function decorateInput(input,index){
    if(input.dataset.photoEditorReady)return;
    input.dataset.photoEditorReady='1';
    const oldLabel=input.closest('label');
    if(!oldLabel)return;

    const field=document.createElement('div');
    field.className='photo-field';
    oldLabel.parentNode.insertBefore(field,oldLabel);
    field.appendChild(input);
    oldLabel.remove();
    input.classList.add('photo-native-input');

    const title=document.createElement('div');
    title.className='photo-field-title';
    title.innerHTML='<strong>Foto</strong><small>Você poderá recortar e ajustar antes de enviar.</small>';

    const picker=document.createElement('button');
    picker.type='button';
    picker.className='photo-picker';
    picker.innerHTML='<span class="photo-picker-icon">＋</span><span><strong>Selecionar foto</strong><small>JPG, PNG ou WebP • recorte 4:3</small></span><span class="photo-picker-arrow">›</span>';

    const selected=document.createElement('div');
    selected.className='photo-selected';
    selected.innerHTML=`<div class="photo-preview-box"><img class="photo-preview-img" alt="Prévia da foto selecionada"></div><div class="photo-selected-info"><strong>Foto pronta</strong><span class="photo-selected-name">Nenhuma foto selecionada</span><div class="photo-selected-actions"><button type="button" data-photo-edit>Editar</button><button type="button" data-photo-change>Trocar</button><button type="button" class="remove" data-photo-remove>Remover</button></div></div>`;

    field.append(title,picker,selected);
    states.set(input,{file:null,previewUrl:null});

    picker.addEventListener('click',()=>input.click());
    selected.querySelector('[data-photo-change]').addEventListener('click',()=>input.click());
    selected.querySelector('[data-photo-edit]').addEventListener('click',()=>{
      const state=states.get(input);
      if(state?.file)openEditor(input,state.file,true);
    });
    selected.querySelector('[data-photo-remove]').addEventListener('click',()=>clearPreview(input));

    input.addEventListener('change',()=>{
      const file=input.files?.[0];
      if(!file)return;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
        showToast('Escolha uma imagem JPG, PNG ou WebP.');
        assignFile(input,states.get(input)?.file||null);
        return;
      }
      if(file.size>MAX_SOURCE_SIZE){
        showToast('A imagem original deve ter no máximo 15 MB.');
        assignFile(input,states.get(input)?.file||null);
        return;
      }
      openEditor(input,file,false);
    });

    input.form?.addEventListener('reset',()=>setTimeout(()=>clearPreview(input),0));
  }

  function openEditor(input,file,isEditing){
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const baseScale=Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight);
      active={input,file,img,baseScale,zoom:1,x:0,y:0,dragging:false,pointerId:null,startX:0,startY:0,startOffsetX:0,startOffsetY:0,isEditing};
      centerImage();
      zoomInput.value='1';
      overlay.hidden=false;
      document.documentElement.classList.add('photo-editor-open');
      draw();
      requestAnimationFrame(()=>saveButton.focus());
    };
    img.onerror=()=>{
      URL.revokeObjectURL(url);
      showToast('Não foi possível abrir essa imagem.');
      assignFile(input,states.get(input)?.file||null);
    };
    img.src=url;
  }

  function scaledSize(){
    const scale=active.baseScale*active.zoom;
    return{w:active.img.naturalWidth*scale,h:active.img.naturalHeight*scale};
  }

  function centerImage(){
    if(!active)return;
    const {w,h}=scaledSize();
    active.x=(canvas.width-w)/2;
    active.y=(canvas.height-h)/2;
    constrain();
  }

  function constrain(){
    if(!active)return;
    const {w,h}=scaledSize();
    active.x=Math.min(0,Math.max(canvas.width-w,active.x));
    active.y=Math.min(0,Math.max(canvas.height-h,active.y));
  }

  function draw(){
    if(!active)return;
    const {w,h}=scaledSize();
    ctx.fillStyle='#0b1220';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(active.img,active.x,active.y,w,h);
    ctx.strokeStyle='rgba(255,255,255,.92)';
    ctx.lineWidth=4;
    ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);
    ctx.strokeStyle='rgba(255,255,255,.28)';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(canvas.width/3,0);ctx.lineTo(canvas.width/3,canvas.height);
    ctx.moveTo(canvas.width*2/3,0);ctx.lineTo(canvas.width*2/3,canvas.height);
    ctx.moveTo(0,canvas.height/3);ctx.lineTo(canvas.width,canvas.height/3);
    ctx.moveTo(0,canvas.height*2/3);ctx.lineTo(canvas.width,canvas.height*2/3);
    ctx.stroke();
  }

  function setZoom(next){
    if(!active)return;
    next=Math.min(3,Math.max(1,Number(next)));
    const oldScale=active.baseScale*active.zoom;
    const centerImageX=(canvas.width/2-active.x)/oldScale;
    const centerImageY=(canvas.height/2-active.y)/oldScale;
    active.zoom=next;
    const newScale=active.baseScale*active.zoom;
    active.x=canvas.width/2-centerImageX*newScale;
    active.y=canvas.height/2-centerImageY*newScale;
    constrain();
    zoomInput.value=String(next);
    draw();
  }

  function cancelEditor(){
    if(!active)return closeEditor(false);
    assignFile(active.input,states.get(active.input)?.file||null);
    closeEditor(false);
  }

  function closeEditor(){
    overlay.hidden=true;
    document.documentElement.classList.remove('photo-editor-open');
    active=null;
  }

  zoomInput.addEventListener('input',()=>setZoom(zoomInput.value));
  overlay.querySelector('[data-zoom="out"]').addEventListener('click',()=>setZoom((active?.zoom||1)-0.15));
  overlay.querySelector('[data-zoom="in"]').addEventListener('click',()=>setZoom((active?.zoom||1)+0.15));
  resetButton.addEventListener('click',()=>{if(!active)return;active.zoom=1;zoomInput.value='1';centerImage();draw();});
  closeButton.addEventListener('click',cancelEditor);
  cancelButton.addEventListener('click',cancelEditor);
  overlay.addEventListener('click',e=>{if(e.target===overlay)cancelEditor();});
  card.addEventListener('click',e=>e.stopPropagation());

  canvas.addEventListener('pointerdown',e=>{
    if(!active)return;
    active.dragging=true;active.pointerId=e.pointerId;
    active.startX=e.clientX;active.startY=e.clientY;
    active.startOffsetX=active.x;active.startOffsetY=active.y;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove',e=>{
    if(!active?.dragging||e.pointerId!==active.pointerId)return;
    const rect=canvas.getBoundingClientRect();
    active.x=active.startOffsetX+(e.clientX-active.startX)*(canvas.width/rect.width);
    active.y=active.startOffsetY+(e.clientY-active.startY)*(canvas.height/rect.height);
    constrain();draw();
  });
  const endDrag=e=>{
    if(!active||e.pointerId!==active.pointerId)return;
    active.dragging=false;active.pointerId=null;canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup',endDrag);
  canvas.addEventListener('pointercancel',endDrag);

  canvas.addEventListener('wheel',e=>{
    if(!active)return;
    e.preventDefault();
    setZoom(active.zoom+(e.deltaY<0?0.08:-0.08));
  },{passive:false});

  saveButton.addEventListener('click',()=>{
    if(!active)return;
    const input=active.input;
    saveButton.disabled=true;
    saveButton.textContent='Salvando...';
    const output=document.createElement('canvas');
    output.width=OUTPUT_WIDTH;output.height=OUTPUT_HEIGHT;
    const out=output.getContext('2d',{alpha:false});
    out.imageSmoothingEnabled=true;out.imageSmoothingQuality='high';
    const {w,h}=scaledSize();
    const sx=OUTPUT_WIDTH/canvas.width,sy=OUTPUT_HEIGHT/canvas.height;
    out.fillStyle='#fff';out.fillRect(0,0,OUTPUT_WIDTH,OUTPUT_HEIGHT);
    out.drawImage(active.img,active.x*sx,active.y*sy,w*sx,h*sy);
    output.toBlob(blob=>{
      saveButton.disabled=false;saveButton.textContent='Usar esta foto';
      if(!blob){showToast('Não foi possível processar a foto.');return;}
      const base=(active.file.name||'foto').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,50)||'foto';
      const finalFile=new File([blob],`${base}-editada.jpg`,{type:'image/jpeg',lastModified:Date.now()});
      setFinalFile(input,finalFile);
      closeEditor();
    },'image/jpeg',0.9);
  });

  document.addEventListener('keydown',e=>{
    if(overlay.hidden)return;
    if(e.key==='Escape')cancelEditor();
  });

  document.querySelectorAll('input[type="file"][name="image"]').forEach(decorateInput);
})();

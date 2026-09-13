/* ============================================================
   BLOSS FOODS — MASTER SCRIPT ENGINE (v3, Supabase-backed)
   Products, stock, cart, favorites, and accounts all live in
   Supabase now, so everything syncs across devices and staff
   logins in real time. Requires supabase-config.js to be loaded
   first (see that file for setup).
   ============================================================ */

// ============ RUNTIME STATE (populated after login) ============
let PRODUCTS = [];
let PRODUCT_MAP = {};
let cart = [];          // rows from cart_items
let favorites = [];     // array of product_id
let currentUser = null;
let currentProfile = null;

// ============ BOOTSTRAP ============
// Call this at the top of every protected page. Returns true if the
// session is valid and app state is loaded; false if it redirected
// the visitor to the login page (caller should stop further work).
async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        if (!location.pathname.endsWith('entry.html')) {
            window.location.href = 'entry.html';
        }
        return false;
    }
    currentUser = session.user;

    const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
    if (profErr) { console.error('Profile load failed:', profErr); }
    currentProfile = profile || null;

    await loadProducts();
    await loadCart();
    await loadFavorites();
    subscribeRealtime();

    // Reveal the staff-only nav link if this account has the staff role
    const staffLink = document.getElementById('staff-link');
    if (staffLink && currentProfile && currentProfile.role === 'staff') {
        staffLink.style.display = 'inline';
    }
    const nameTag = document.getElementById('account-name');
    if (nameTag && currentProfile) {
        nameTag.textContent = currentProfile.full_name || currentUser.email;
    }

    updateUI();
    return true;
}

async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'entry.html';
}

// ============ DATA LOADING ============
async function loadProducts() {
    const { data, error } = await supabase.from('products').select('*').order('category');
    if (error) { console.error('Product load failed:', error); return; }
    PRODUCTS = data;
    PRODUCT_MAP = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
}

async function loadCart() {
    const { data, error } = await supabase
        .from('cart_items')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at');
    if (error) { console.error('Cart load failed:', error); return; }
    cart = data;
}

async function loadFavorites() {
    const { data, error } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', currentUser.id);
    if (error) { console.error('Favorites load failed:', error); return; }
    favorites = data.map(r => r.product_id);
}

// Live sync: any staff edit or concurrent purchase updates every open device instantly
function subscribeRealtime() {
    supabase.channel('public:products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
            const updated = payload.new;
            if (!updated) return;
            const local = PRODUCT_MAP[updated.id];
            if (local) {
                local.stock = updated.stock;
                local.price = updated.price;
                local.variants = updated.variants;
                local.name = updated.name;
            }
            if (document.getElementById('product-grid')) {
                renderShop(window.currentCategory, window.currentSearch);
            }
            renderAdminList();
        })
        .subscribe();
}

// ============ UI CONTROLS ============
function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    if (sidebar) sidebar.classList.toggle('active');
}

function toggleChat() {
    const c = document.getElementById('ai-chat');
    if (c) c.style.display = (c.style.display === 'block') ? 'none' : 'block';
}

function cartItemLabel(item) {
    const p = PRODUCT_MAP[item.product_id];
    const base = p ? p.name : item.product_id;
    return item.variant_label ? `${base} (${item.variant_label})` : base;
}

function itemTotal(item) {
    return item.qty * item.price;
}

// ============ FAVORITES ============
async function toggleFavorite(productId) {
    if (favorites.includes(productId)) {
        await supabase.from('favorites').delete().eq('user_id', currentUser.id).eq('product_id', productId);
        favorites = favorites.filter(id => id !== productId);
    } else {
        await supabase.from('favorites').insert({ user_id: currentUser.id, product_id: productId });
        favorites.push(productId);
    }
    renderShop(window.currentCategory, window.currentSearch);
}

// ============ QUANTITY STEPPER ============
function changeQty(productId, delta) {
    const input = document.getElementById(`qty-${productId}`);
    if (!input) return;
    let val = (parseInt(input.value) || 1) + delta;
    const stock = PRODUCT_MAP[productId]?.stock ?? 0;
    if (val < 1) val = 1;
    if (stock > 0 && val > stock) val = stock;
    input.value = val;
}

// ============ RENDER PRODUCT GRID (shop.html) ============
function renderShop(filterCategory, searchTerm) {
    const grid = document.getElementById('product-grid');
    if (!grid) return;

    const term = (searchTerm || '').toLowerCase();
    const visible = PRODUCTS.filter(p => {
        let matchesCategory;
        if (!filterCategory || filterCategory === 'All') matchesCategory = true;
        else if (filterCategory === 'Favorites') matchesCategory = favorites.includes(p.id);
        else matchesCategory = p.category === filterCategory;
        const matchesSearch = !term || p.name.toLowerCase().includes(term);
        return matchesCategory && matchesSearch;
    });

    if (visible.length === 0) {
        const emptyMsg = filterCategory === 'Favorites'
            ? "No favorites yet — tap the ♡ on any product to save it here."
            : "No products match your search.";
        grid.innerHTML = `<p style="opacity:0.6; padding:20px;">${emptyMsg}</p>`;
        return;
    }

    grid.innerHTML = visible.map(p => {
        const stock = p.stock ?? 0;
        const disabled = stock <= 0;
        const isFav = favorites.includes(p.id);
        let priceHTML, controlHTML;

        if (p.variants) {
            const lo = Math.min(...p.variants.map(v => v.price));
            const hi = Math.max(...p.variants.map(v => v.price));
            priceHTML = `₦${lo.toLocaleString()} - ₦${hi.toLocaleString()}`;
            controlHTML = `
                <select id="unit-${p.id}" class="qty-input">
                    ${p.variants.map(v => `<option value="${v.price}" data-label="${v.label}">${v.label} - ₦${v.price.toLocaleString()}</option>`).join('')}
                </select>`;
        } else {
            priceHTML = `₦${p.price.toLocaleString()}`;
            controlHTML = '';
        }

        return `
            <div class="card ${disabled ? 'out-of-stock' : ''}">
                <button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${p.id}')" aria-label="Save to favorites">${isFav ? '♥' : '♡'}</button>
                <span class="category-tag">${p.category}</span>
                <h3>${p.name}</h3>
                <p class="price-tag">${priceHTML}</p>
                <p style="font-size:0.8rem;">Available: <span id="stock-${p.id}">${stock}</span></p>
                ${controlHTML}
                <div class="qty-stepper">
                    <button onclick="changeQty('${p.id}', -1)" ${disabled ? 'disabled' : ''}>&minus;</button>
                    <input type="number" id="qty-${p.id}" value="1" min="1" class="qty-input" ${disabled ? 'disabled' : ''}>
                    <button onclick="changeQty('${p.id}', 1)" ${disabled ? 'disabled' : ''}>+</button>
                </div>
                <div id="btn-${p.id}">
                    ${disabled
                        ? `<button class="add-btn out-of-stock-btn" disabled>STOCK FINISHED</button>`
                        : `<button class="add-btn" onclick="addToCart('${p.id}')">Add to Cart</button>`}
                </div>
            </div>`;
    }).join('');
}

// ============ CART CORE LOGIC ============
async function addToCart(productId) {
    const product = PRODUCT_MAP[productId];
    if (!product) return;

    const qtyInput = document.getElementById(`qty-${productId}`);
    if (!qtyInput) return;
    const qty = parseInt(qtyInput.value) || 1;

    let price = product.price;
    let variantLabel = null;
    let label = product.name;

    if (product.variants) {
        const sel = document.getElementById(`unit-${productId}`);
        price = parseInt(sel.value);
        variantLabel = sel.options[sel.selectedIndex].dataset.label;
        label = `${product.name} (${variantLabel})`;
    }

    // Atomic, race-safe: won't let two customers both take the last item
    const { data: newStock, error } = await supabase.rpc('adjust_stock', { p_id: productId, delta: -qty });
    if (error) {
        showToast(`Insufficient stock! Only ${product.stock} left.`, 'error');
        return;
    }
    product.stock = newStock;

    const { data: inserted, error: insertErr } = await supabase
        .from('cart_items')
        .insert({ user_id: currentUser.id, product_id: productId, variant_label: variantLabel, price, qty })
        .select()
        .single();

    if (insertErr) {
        console.error(insertErr);
        // roll back the stock reservation if the cart insert failed
        await supabase.rpc('adjust_stock', { p_id: productId, delta: qty });
        product.stock += qty;
        showToast('Could not add to basket, please try again.', 'error');
        renderShop(window.currentCategory, window.currentSearch);
        return;
    }

    cart.push(inserted);
    showToast(`Added ${qty} × ${label} to basket`);
    updateUI();
    renderShop(window.currentCategory, window.currentSearch);
}

async function removeItem(cartItemId) {
    const item = cart.find(i => i.id === cartItemId);
    if (!item) return;

    await supabase.rpc('adjust_stock', { p_id: item.product_id, delta: item.qty });
    const product = PRODUCT_MAP[item.product_id];
    if (product) product.stock += item.qty;

    await supabase.from('cart_items').delete().eq('id', cartItemId);
    cart = cart.filter(i => i.id !== cartItemId);

    updateUI();
    renderShop(window.currentCategory, window.currentSearch);
}

// ============ TOAST NOTIFICATIONS ============
function showToast(message, type) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast-msg${type === 'error' ? ' toast-error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
}

// ============ UI UPDATE ENGINE (cart sidebar) ============
function updateUI() {
    const cont = document.getElementById('side-cart-items');
    const totS = document.getElementById('side-total');
    const countS = document.getElementById('cart-count');
    let total = 0;

    if (cont) {
        cont.innerHTML = cart.length === 0 ? `<p style="opacity:0.5; text-align:center;">Empty Basket</p>` :
        cart.map(item => {
            total += itemTotal(item);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #222; padding-bottom:5px;">
                    <span style="font-size:0.85rem;">${item.qty}x ${cartItemLabel(item)}</span>
                    <button onclick="removeItem(${item.id})" style="color:#ff4444; background:none; border:none; cursor:pointer; font-weight:bold; font-size:1.2rem;">&times;</button>
                </div>`;
        }).join('');
        if (totS) totS.innerText = total.toLocaleString();
        if (countS) countS.innerText = cart.length;
    }
}

// ============ ADMIN / STAFF INVENTORY PANEL ============
function openAdmin() {
    const panel = document.getElementById('admin-panel');
    if (!panel) return;
    if (!currentProfile || currentProfile.role !== 'staff') {
        showToast('Staff access only.', 'error');
        return;
    }
    panel.style.display = 'block';
    renderAdminList();
}

function renderAdminList() {
    const panel = document.getElementById('admin-panel');
    const list = document.getElementById('admin-list');
    if (!panel || !list || panel.style.display === 'none') return;
    list.innerHTML = PRODUCTS.map(p => `
        <div class="card">
            <h4>${p.name}</h4>
            <input type="number" id="adm-${p.id}" value="${p.stock}" class="qty-input">
        </div>`).join('');
}

async function saveInv() {
    if (!currentProfile || currentProfile.role !== 'staff') return;
    const btn = document.getElementById('save-inv-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    for (const p of PRODUCTS) {
        const input = document.getElementById(`adm-${p.id}`);
        if (!input) continue;
        const newStock = parseInt(input.value) || 0;
        if (newStock === p.stock) continue;
        await supabase.from('products').update({ stock: newStock }).eq('id', p.id);
        p.stock = newStock;
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Save Inventory'; }
    showToast('Inventory synced — every device updates instantly.');
    renderShop(window.currentCategory, window.currentSearch);
}

// ============ REVIEWS / SOCIAL WALL ============
async function postReview() {
    const ratingEl = document.getElementById('rev-rating');
    const commentEl = document.getElementById('rev-comment');
    if (!ratingEl || !commentEl) return;
    const stars = parseInt(ratingEl.value);
    const comment = commentEl.value.trim();
    if (!comment) { showToast('Please write a comment first.', 'error'); return; }

    const { error } = await supabase.from('reviews').insert({
        user_id: currentUser.id,
        full_name: (currentProfile && currentProfile.full_name) || 'Guest',
        stars, comment
    });
    if (error) { console.error(error); showToast('Could not post review.', 'error'); return; }

    commentEl.value = '';
    showToast('Thanks for the review!');
    loadReviews();
}

async function loadReviews() {
    const feed = document.getElementById('wall-feed');
    if (!feed) return;
    const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) { console.error(error); return; }

    feed.innerHTML = (data || []).map(r => `
        <div class="card" style="margin-bottom:15px; text-align:left; border-left:4px solid var(--gold);">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--gold);">
                <strong>${r.full_name}</strong><span>${new Date(r.created_at).toLocaleDateString()}</span>
            </div>
            <div style="margin:5px 0;">${'⭐'.repeat(r.stars)}</div>
            <p style="margin:0; opacity:0.8; font-size:0.9rem;">${r.comment}</p>
        </div>`).join('');
}

// ============ AI CHAT ============
function askAI() {
    const input = document.getElementById('chat-input').value.toLowerCase();
    const box = document.getElementById('chat-box');
    let res = "Please contact 09033448814 for direct assistance!";

    if (input.includes("price")) res = "Check the Shop page for full up-to-date pricing on all items!";
    if (input.includes("delivery")) res = "We deliver to FUNAAB hostels. Fee for off-campus areas is ₦500.";

    box.innerHTML += `<div class="user-msg">You: ${input}</div>`;
    box.innerHTML += `<div class="bot-msg">AI: ${res}</div>`;
    document.getElementById('chat-input').value = "";
    box.scrollTop = box.scrollHeight;
}

// ============ ORDER SUBMISSION (checkout.html) ============
async function sendOrder(typedName, loc) {
    if (!typedName || !loc) { showToast('Please provide your name and address.', 'error'); return; }
    if (cart.length === 0) { showToast('Your basket is empty.', 'error'); return; }

    const locL = loc.toLowerCase();
    const paidAreas = ['oluwo', 'harmony', 'accord', 'kofesu', 'camp', 'isolu'];
    let fee = paidAreas.some(area => locL.includes(area)) ? 500 : 0;
    if (!locL.includes('hostel') && fee === 0) fee = 500;

    const itemsForOrder = cart.map(i => ({
        product_id: i.product_id, name: cartItemLabel(i), qty: i.qty, price: i.price, total: itemTotal(i)
    }));
    const subtotal = cart.reduce((s, i) => s + itemTotal(i), 0);

    let msg = `*BLOSS FOODS ORDER*\nCustomer: ${typedName}\nAddress: ${loc}\n\n`;
    itemsForOrder.forEach(i => { msg += `- ${i.qty}x ${i.name} (₦${i.total.toLocaleString()})\n`; });
    msg += `\nDelivery Fee: ₦${fee}\n*TOTAL: ₦${(subtotal + fee).toLocaleString()}*`;

    await supabase.from('orders').insert({
        user_id: currentUser.id,
        customer_name: typedName,
        address: loc,
        items: itemsForOrder,
        subtotal, delivery_fee: fee, total: subtotal + fee
    });

    await supabase.from('cart_items').delete().eq('user_id', currentUser.id);
    cart = [];
    updateUI();

    window.open(`https://wa.me/2349033448814?text=${encodeURIComponent(msg)}`, '_blank');
}

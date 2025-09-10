// Подключение к серверу
const socket = io();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "071117";
let isAdmin = false;
let votingOptions = [];
let votes = {};
let currentEditCardId = null;
let votingUrl = '';
let currentUserId = localStorage.getItem('userId');
let selectedOptionId = null;
let currentUser = null;

// Инициализация страницы
document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    checkAdminMode();
    checkSavedUser();
});

// Настройка обработчиков событий
function setupEventListeners() {
    // Основные кнопки
    document.getElementById('loginBtn').addEventListener('click', loginUser);
    document.getElementById('createAccountBtn').addEventListener('click', showCreateAccount);
    document.getElementById('saveUserInfo').addEventListener('click', saveUserInfo);
    document.getElementById('adminLoginBtn').addEventListener('click', showPasswordModal);
    document.getElementById('submitPassword').addEventListener('click', checkAdminPassword);
    document.getElementById('cancelPassword').addEventListener('click', hidePasswordModal);
    document.getElementById('backToVote').addEventListener('click', backToVoting);
    document.getElementById('newVotingBtn').addEventListener('click', startNewVoting);
    document.getElementById('saveChangesBtn').addEventListener('click', saveChanges);
    document.getElementById('historyBtn').addEventListener('click', showHistoryModal);
    document.getElementById('copyLinkBtn').addEventListener('click', copyLinkToClipboard);
    document.getElementById('showUsersBtn').addEventListener('click', showUsersList);
    document.getElementById('profileBtn').addEventListener('click', toggleProfileMenu);
    document.getElementById('editProfileBtn').addEventListener('click', editProfile);
    document.getElementById('logoutBtn').addEventListener('click', logoutUser);

    // Кнопки редактирования карточек
    document.getElementById('saveCardEdit').addEventListener('click', saveCardEdit);
    document.getElementById('cancelCardEdit').addEventListener('click', cancelCardEdit);
    document.getElementById('uploadImageBtn').addEventListener('click', triggerImageUpload);
    document.getElementById('imageUpload').addEventListener('change', handleImageUpload);

    // Обработка Enter в формах
    document.getElementById('passwordInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') checkAdminPassword();
    });

    document.getElementById('loginName').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') document.getElementById('loginSurname').focus();
    });

    document.getElementById('loginSurname').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') loginUser();
    });

    // Закрытие модальных окон
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function () {
            this.closest('.modal').style.display = 'none';
        });
    });

    // Закрытие модальных окон по клику вне области
    window.addEventListener('click', function (event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
        if (!event.target.closest('.profile-menu') && !event.target.closest('.profile-btn')) {
            document.getElementById('profileMenu').classList.remove('show');
        }
    });

    // Обработка событий от сервера
    socket.on('init', (data) => {
        // Если сервер только что перезапускался — сбросить локальную "сессию"
        const prevBootId = localStorage.getItem('bootId');
        if (String(prevBootId) !== String(data.bootId)) {
            localStorage.removeItem('userId');
            localStorage.removeItem('userData');
            localStorage.setItem('bootId', String(data.bootId));

            // Показать экран входа и спрятать остальное
            const loginForm = document.getElementById('loginForm');
            const userInfo = document.getElementById('userInfo');
            const optionsContainer = document.getElementById('optionsContainer');
            if (loginForm) loginForm.classList.remove('hidden');
            if (userInfo) userInfo.classList.add('hidden');
            if (optionsContainer) optionsContainer.classList.add('hidden');
        }
        votingOptions = data.options;
        votes = data.results.results;
        votingUrl = data.votingUrl;
        renderVotingOptions(votingOptions);
        renderResults();
        updateAdminLink();
        generateQRCode();
    });

    socket.on('updateResults', (data) => {
        votes = data.results;
        renderResults();
    });

    socket.on('voteSuccess', (message) => {
        showMessage(message);
        selectedOptionId = null;
        document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
    });

    socket.on('voteError', (message) => {
        showMessage(message);
    });

    socket.on('newVotingStarted', () => {
        showMessage('Начато новое голосование!');
        selectedOptionId = null;
        document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
    });

    socket.on('optionsUpdated', (options) => {
        votingOptions = options;
        renderVotingOptions(options);
        renderEditOptions(options);
    });

    socket.on('historyData', (history) => {
        renderHistoryList(history);
    });

    socket.on('usersData', (users) => {
        renderUsersList(users);
    });

    socket.on('userSaved', (data) => {
        currentUserId = data.userId;
        currentUser = data.user;
        localStorage.setItem('userId', currentUserId);
        localStorage.setItem('userData', JSON.stringify(data.user));
        hideUserInfo();
        showVotingOptions();
        showMessage('Профиль сохранен!');
    });

    socket.on('userFound', (data) => {
        if (data.success) {
            currentUserId = data.userId;
            currentUser = data.user;
            localStorage.setItem('userId', currentUserId);
            localStorage.setItem('userData', JSON.stringify(data.user));
            hideLoginForm();
            showVotingOptions();
            showMessage(`Добро пожаловать, ${data.user.name}!`);
        } else {
            showMessage('Пользователь не найден. Создайте новый аккаунт.');
        }
    });

    socket.on('cardEdited', (data) => {
        if (data.success) {
            showMessage(data.message);
            // Обновляем локальные данные
            const cardIndex = votingOptions.findIndex(option => option.id == currentEditCardId);
            if (cardIndex !== -1) {
                votingOptions[cardIndex].text = document.getElementById('editCardTitle').value;
                votingOptions[cardIndex].image = document.getElementById('editCardImage').value;
                renderEditOptions(votingOptions);
            }
        } else {
            showMessage(data.message);
        }
    });
}

// Проверка сохраненного пользователя
function checkSavedUser() {
    const savedUser = localStorage.getItem('userData');
    if (savedUser && currentUserId) {
        currentUser = JSON.parse(savedUser);
        hideLoginForm();
        showVotingOptions();
    }
}

// Проверка админ-режима из URL
function checkAdminMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');

    if (password === ADMIN_PASSWORD) {
        isAdmin = true;
        socket.emit('adminLogin', password); // сообщаем серверу
        showAdminPanel();
        socket.emit('getUsers');
    }
}

// Вход пользователя
function loginUser() {
    const name = document.getElementById('loginName').value.trim();
    const surname = document.getElementById('loginSurname').value.trim();

    if (!name || !surname) {
        showMessage('Пожалуйста, введите имя и фамилию');
        return;
    }

    socket.emit('findUser', { name, surname });
}

// Показать форму создания аккаунта
function showCreateAccount() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('userInfo').classList.remove('hidden');
}

// Сохранение информации о пользователе
function saveUserInfo() {
    const userData = {
        name: document.getElementById('userName').value.trim(),
        surname: document.getElementById('userSurname').value.trim(),
        age: document.getElementById('userAge').value,
        school: document.getElementById('userSchool').value.trim(),
        birthday: document.getElementById('userBirthday').value,
        bio: document.getElementById('userBio').value.trim()
    };

    if (!userData.name || !userData.surname) {
        showMessage('Пожалуйста, введите имя и фамилию');
        return;
    }

    socket.emit('saveUser', userData);
}

// Скрыть форму информации пользователя
function hideUserInfo() {
    document.getElementById('userInfo').classList.add('hidden');
}

// Скрыть форма входа
function hideLoginForm() {
    document.getElementById('loginForm').classList.add('hidden');
}

// Показать варианты голосования
function showVotingOptions() {
    document.getElementById('optionsContainer').classList.remove('hidden');
}

// Отображение вариантов голосования
function renderVotingOptions(options) {
    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';

    options.forEach(option => {
        const imgSrc = option.image && option.image.startsWith('/uploads/')
            ? `${option.image}?v=${Date.now()}`
            : option.image;
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        optionElement.innerHTML = `
                    <img src="${imgSrc}" alt="${option.text}" onerror="this.onerror=null; this.src='/fallback-400x300.svg'">
                    <h3>${option.text}</h3>
                    <button class="vote-btn" data-option="${option.id}">Подтвердить голос</button>
                `;

        optionElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('vote-btn')) {
                selectOption(option.id);
            }
        });

        optionElement.querySelector('.vote-btn').addEventListener('click', () => {
            castVote(option.id);
        });

        optionsContainer.appendChild(optionElement);
    });
}

// Выбор варианта
function selectOption(optionId) {
    selectedOptionId = optionId;
    document.querySelectorAll('.option').forEach(opt => {
        opt.classList.remove('selected');
    });
    document.querySelector(`.option:nth-child(${optionId})`).classList.add('selected');
}

// Голосование
function castVote(optionId) {
    if (!currentUserId) {
        showMessage('Пожалуйста, сначала войдите в систему');
        return;
    }

    socket.emit('vote', {
        optionId: optionId,
        userId: currentUserId
    });
}

// Отображение результатов
function renderResults() {
    const resultsContainer = document.getElementById('resultsContainer');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = '';

    const totalVotes = Object.values(votes).reduce((sum, option) => sum + (option.count || 0), 0);

    votingOptions.forEach(option => {
        const voteData = votes[option.id] || { count: 0, percentage: 0, voters: [] };
        const voteCount = voteData.count || 0;
        const percentage = voteData.percentage || 0;

        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';

        let votersList = '';
        if (voteData.voters && voteData.voters.length > 0) {
            votersList = `
                        <div class="voters-list">
                            <strong>Проголосовали (${voteData.voters.length}):</strong>
                            ${voteData.voters.slice(0, 5).map(voter => `
                                <div class="voter-item">
                                    <span>${voter.name}</span>
                                    <small>${new Date(voter.timestamp).toLocaleTimeString()}</small>
                                </div>
                            `).join('')}
                            ${voteData.voters.length > 5 ? `
                                <div class="voter-item">... и еще ${voteData.voters.length - 5}</div>
                            ` : ''}
                        </div>
                    `;
        }

        resultItem.innerHTML = `
                    <h4>${option.text}</h4>
                    <div class="result-bar">
                        <div class="result-fill" style="width: ${percentage}%"></div>
                        <div class="result-text">${voteCount} голосов (${percentage}%)</div>
                    </div>
                    ${votersList}
                `;
        resultsContainer.appendChild(resultItem);
    });
}

// Обновление ссылки для админа
function updateAdminLink() {
    document.getElementById('adminLink').textContent = votingUrl;
}

// Генерация QR-кода
function generateQRCode() {
    const canvas = document.getElementById('qrCode');
    QRCode.toCanvas(canvas, votingUrl, {
        width: 160,
        margin: 1,
        color: {
            dark: '#6e8efb',
            light: '#ffffff'
        }
    }, function (error) {
        if (error) console.error(error);
    });
}

// Копирование ссылки в буфер обмена
function copyLinkToClipboard() {
    navigator.clipboard.writeText(votingUrl).then(() => {
        alert('Ссылка скопирована в буфер обмена!');
    }).catch(err => {
        console.error('Ошибка при копировании: ', err);
    });
}

// Показать сообщение
function showMessage(text) {
    const messageElement = document.getElementById('voteMessage');
    messageElement.textContent = text;
    messageElement.classList.remove('hidden');

    setTimeout(() => {
        messageElement.classList.add('hidden');
    }, 3000);
}

// Показать модальное окно для ввода пароля
function showPasswordModal() {
    document.getElementById('passwordModal').style.display = 'block';
    document.getElementById('passwordInput').focus();
}

// Скрыть модальное окно для ввода пароля
function hidePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    document.getElementById('passwordInput').value = '';
    document.getElementById('passwordError').style.display = 'none';
}

// Проверка пароля администратора
function checkAdminPassword() {
    const password = document.getElementById('passwordInput').value;

    if (password === ADMIN_PASSWORD) {
        isAdmin = true;
        // Сообщаем серверу: этот сокет — админ
        socket.emit('adminLogin', password);
        hidePasswordModal();
        showAdminPanel();
        socket.emit('getUsers');
    } else {
        document.getElementById('passwordError').style.display = 'block';
        setTimeout(() => {
            document.getElementById('passwordError').style.display = 'none';
        }, 3000);
    }
}

// Показать админ-панель
function showAdminPanel() {
    document.getElementById('voteTab').classList.add('hidden');
    document.getElementById('adminTab').classList.remove('hidden');
    renderResults();
    renderEditOptions(votingOptions);
}

// Вернуться к голосованию
function backToVoting() {
    document.getElementById('adminTab').classList.add('hidden');
    document.getElementById('voteTab').classList.remove('hidden');
    isAdmin = false;
    window.history.replaceState({}, document.title, window.location.pathname);
}

// Начать новое голосование
function startNewVoting() {
    if (confirm("Вы уверены, что хотите начать новое голосование? Все текущие результаты будут сброшены.")) {
        socket.emit('newVoting');
    }
}

// Сохранить изменения
function saveChanges() {
    socket.emit('updateOptions', votingOptions);
    showMessage('Изменения сохранены!');
}

// Показать историю голосований
function showHistoryModal() {
    socket.emit('getHistory');
    document.getElementById('historyModal').style.display = 'block';
}

// Показать список пользователей
function showUsersList() {
    socket.emit('getUsers');
    document.getElementById('usersList').classList.toggle('hidden');
}

// Переключение меню профиля
function toggleProfileMenu() {
    document.getElementById('profileMenu').classList.toggle('show');
}

// Редактирование профиля
function editProfile() {
    if (currentUser) {
        document.getElementById('userName').value = currentUser.name;
        document.getElementById('userSurname').value = currentUser.surname;
        document.getElementById('userAge').value = currentUser.age || '';
        document.getElementById('userSchool').value = currentUser.school || '';
        document.getElementById('userBirthday').value = currentUser.birthday || '';
        document.getElementById('userBio').value = currentUser.bio || '';

        document.getElementById('userInfo').classList.remove('hidden');
        document.getElementById('optionsContainer').classList.add('hidden');
        document.getElementById('profileMenu').classList.remove('show');
    }
}

// Выход пользователя
function logoutUser() {
    currentUserId = null;
    currentUser = null;
    localStorage.removeItem('userId');
    localStorage.removeItem('userData');

    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('userInfo').classList.add('hidden');
    document.getElementById('optionsContainer').classList.add('hidden');
    document.getElementById('profileMenu').classList.remove('show');

    showMessage('Вы вышли из системы');
}

// Отображение списка пользователей
function renderUsersList(users) {
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';

    if (Object.keys(users).length === 0) {
        usersList.innerHTML = '<p>Нет зарегистрированных пользователей</p>';
        return;
    }

    Object.values(users).forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';

        userItem.innerHTML = `
                    <div class="user-header" onclick="toggleUserItem('${user.name}${user.surname}')">
                        <div>
                            <h4>${user.name} ${user.surname}</h4>
                            <p>${user.age ? `Возраст: ${user.age}` : 'Возраст не указан'} • ${user.school || 'Школа не указана'}</p>
                        </div>
                        <span class="user-toggle">▼</span>
                    </div>
                    <div class="user-content" id="user-${user.name}${user.surname}">
                        <div class="user-details">
                            ${user.birthday ? `<p><strong>Дата рождения:</strong> ${user.birthday}</p>` : ''}
                            ${user.bio ? `<p><strong>О себе:</strong> ${user.bio}</p>` : ''}
                        </div>
                    </div>
                `;

        usersList.appendChild(userItem);
    });
}

// Переключение отображения элемента пользователя
function toggleUserItem(userId) {
    const content = document.getElementById(`user-${userId}`);
    const toggle = content.previousElementSibling.querySelector('.user-toggle');

    content.classList.toggle('expanded');
    toggle.textContent = content.classList.contains('expanded') ? '▲' : '▼';
}

// Отображение списка истории с сворачиванием
function renderHistoryList(history) {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';

    if (history.length === 0) {
        historyList.innerHTML = '<p>История голосований пуста</p>';
        return;
    }

    history.forEach((item, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        historyItem.innerHTML = `
                    <div class="history-header" onclick="toggleHistoryItem(${item.id})">
                        <div>
                            <h4>Голосование #${index + 1}</h4>
                            <p>${new Date(item.date).toLocaleString()} • ${item.totalVotes} участников</p>
                        </div>
                        <span class="history-toggle">▼</span>
                    </div>
                    <div class="history-content" id="history-${item.id}">
                        <div class="results">
                            ${item.options.map(option => {
            const voteData = item.results[option.id] || { count: 0, voters: [] };
            const percentage = item.totalVotes > 0 ? ((voteData.count / item.totalVotes) * 100).toFixed(1) : 0;

            return `
                                    <div class="result-item">
                                        <h4>${option.text}</h4>
                                        <div class="result-bar">
                                            <div class="result-fill" style="width: ${percentage}%"></div>
                                            <div class="result-text">${voteData.count} голосов (${percentage}%)</div>
                                        </div>
                                        ${voteData.voters.length > 0 ? `
                                            <div class="voters-list">
                                                <strong>Проголосовали:</strong>
                                                ${voteData.voters.map(voter => `
                                                    <div class="voter-item">
                                                        <span>${voter.name}</span>
                                                        <small>${new Date(voter.timestamp).toLocaleTimeString()}</small>
                                                    </div>
                                                `).join('')}
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                `;

        historyList.appendChild(historyItem);
    });
}

// Переключение отображения элемента истории
function toggleHistoryItem(id) {
    const content = document.getElementById(`history-${id}`);
    const toggle = content.previousElementSibling.querySelector('.history-toggle');

    content.classList.toggle('expanded');
    toggle.textContent = content.classList.contains('expanded') ? '▲' : '▼';
}

// Отображение вариантов для редактирования
function renderEditOptions(options) {
    const editContainer = document.getElementById('editOptionsContainer');
    editContainer.innerHTML = '';

    options.forEach(option => {
        const imgSrc = option.image && option.image.startsWith('/uploads/')
            ? `${option.image}?v=${Date.now()}`
            : option.image;
        const editOptionElement = document.createElement('div');
        editOptionElement.className = 'edit-option';
        editOptionElement.innerHTML = `
                    <img src="${imgSrc}" alt="${option.text}" onerror="this.onerror=null; this.src='/fallback-400x300.svg'">
                    <h4>${option.text}</h4>
                    <div class="edit-buttons">
                        <button class="edit-btn" data-edit="${option.id}">Изменить</button>
                    </div>
                `;

        editOptionElement.querySelector('.edit-btn').addEventListener('click', () => {
            openEditCardModal(option.id);
        });

        editContainer.appendChild(editOptionElement);
    });
}

// Открытие модального окна для редактирования карточки
function openEditCardModal(cardId) {
    const card = votingOptions.find(option => option.id == cardId);
    if (card) {
        document.getElementById('editCardTitle').value = card.text;
        document.getElementById('editCardImage').value = card.image;
        document.getElementById('imagePreview').src = card.image;
        currentEditCardId = cardId;
        document.getElementById('editCardModal').style.display = 'block';
    }
}

// Сохранение редактирования карточки
function saveCardEdit() {
    if (!currentEditCardId) return;

    const title = document.getElementById('editCardTitle').value.trim();
    const image = document.getElementById('editCardImage').value.trim();

    if (!title) {
        alert('Пожалуйста, введите заголовок карточки');
        return;
    }

    if (!image) {
        alert('Пожалуйста, введите ссылку на изображение');
        return;
    }

    // Отправляем данные на сервер
    socket.emit('editCard', {
        cardId: currentEditCardId,
        title: title,
        image: image
    });

    document.getElementById('editCardModal').style.display = 'none';
}

// Отмена редактирования карточки
function cancelCardEdit() {
    document.getElementById('editCardModal').style.display = 'none';
    currentEditCardId = null;
}

// Запуск загрузки изображения
function triggerImageUpload() {
    document.getElementById('imageUpload').click();
}

// Обработка загрузки изображения
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Пожалуйста, выберите файл изображения');
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        alert('Размер файла не должен превышать 5MB');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    // Показываем индикатор загрузки
    const uploadBtn = document.getElementById('uploadImageBtn');
    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = 'Загрузка...';
    uploadBtn.disabled = true;

    fetch('/upload-image', {
        method: 'POST',
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.imageUrl) {
                document.getElementById('editCardImage').value = data.imageUrl;
                document.getElementById('imagePreview').src = data.imageUrl;
                document.getElementById('imagePreview').style.display = 'block';
                showMessage('Изображение успешно загружено!');
            } else {
                throw new Error('Ошибка загрузки изображения');
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки:', error);
            alert('Ошибка при загрузке изображения: ' + error.message);
        })
        .finally(() => {
            uploadBtn.textContent = originalText;
            uploadBtn.disabled = false;
            event.target.value = ''; // Сбрасываем input file
        });
}
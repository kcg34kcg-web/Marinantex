ï»¿Mevzuat = function () {
    return {
        SetUser: function () {
            $.ajax({
                url: "/User/GetUser",
                cache: false,
                type: "GET",
                success: function (response) {
                    if (response.IsAuth) {
                        document.getElementById('userNameLogin').innerText = response.Name + " " + response.Lastname;
                        document.getElementById("userNameLoginDiv").style.display = "block";
                        document.getElementById("userNameSessionDiv").style.display = "none";
                    }
                    else {
                        document.getElementById("userNameLoginDiv").style.display = "none";
                        document.getElementById("userNameSessionDiv").style.display = "block";
                    }
                }
            });
        },
        ChangeFavorites: function (id) {
            var element = document.getElementById(id);
            if (element.className.indexOf("far fa-star") > -1 || element.className.indexOf("fas fa-star") > -1) {
                var postData = { EntityID: id };
                Mevzuat.Ajax("Favorites/AddOrUpdateFavorite", { data: postData }, function (e) {
                    if (e.IsSucceed) {
                        if (element.className.indexOf("fas fa-star") > -1) {//Ekle
                            element.className = element.className.replace("fas", "far");
                            element.title = "Favorilere Ekle";
                        }
                        else {//ÃÄ±kar
                            element.className = element.className.replace("far", "fas");
                            element.title = "Favorilerden KaldÄ±r";
                        }
                        element.tabIndex = 0;
                        element.style.outline = "0px";
                    }
                });
            }
        },
        SignOut: function () {
            Sys.Alert({ message: 'Oturumunuz sonlandÄ±. GiriÅ sayfasÄ±na yÃ¶nlendiriliyorsunuz...', title: '' });
            setTimeout(function () {
                localStorage.clear();
                location.href = '/Anasayfa';
            }, 2000);
        }
        ,
        HandleError: function (jqXHR) {
            Mevzuat.unblockUI();
            if (jqXHR.status === 407) {
                var gelen = jQuery.parseJSON(jqXHR.responseText);
                Mevzuat.Alert(gelen.Message, 'HATA!');
                setTimeout(function () {
                    location.href = gelen.Value;
                }, 3000);

            } else if (jqXHR.status === 405 || jqXHR.status === 417) {

                var reponse = jQuery.parseJSON(jqXHR.responseText);
                Mevzuat.Alert({ message: reponse.Message, title: 'HATA!' });

            } else if (jqXHR.status === 404) {

                Mevzuat.Alert({ message: 'Sayfa bulunamadÄ±.', title: 'HATA!' });

            } else if (jqXHR.status === 401) {
                localStorage.clear();
                Mevzuat.Alert({ message: 'Oturumunuz sonlandÄ±. GiriÅ sayfasÄ±na yÃ¶lendiriliyorsunuz...', title: '' });
                setTimeout(function () {
                    location.href = '/Anasayfa';
                }, 3000);

            } else if (jqXHR.status === 600) {
                Sys.Noty('GirdiÄiniz bilgileri kontrol ediniz', "", "error");
            } else {
                Mevzuat.Alert({ message: 'Beklenmeyen bir hata oluÅtu lÃ¼tfen daha sonra tekrar deneyiniz.', title: 'HATA!' });
            }
        },
        unblockUI: function (target) {
            self.loadingCount--;
            if (self.loadingCount == 0) {
                if (target) {
                    $(target).unblock({
                        onUnblock: function () {
                            $(target).css('position', '');
                            $(target).css('zoom', '');
                        },
                        fadeOut: 200
                    });
                } else {
                    $.unblockUI({ fadeOut: 200 });
                }


            }
        },
        Ajax: function (url, opts, sonuc) {
            if (!opts) opts = {};

            if (typeof (opts.loading) === "undefined" || opts.loading) {
                Sys.blockUI(opts.loadingMsg);
            }

            if (opts.element) {
                $(opts.element).empty();
                $(opts.element).hide();
            }


            if (opts.form) {
                if (!opts.data) opts.data = {};
                opts.data = Object.extend(opts.data, $(opts.form).serializeObject());

                $.each($(opts.form + ' input[type=checkbox]'), function (index, eleme) {
                    opts.data[this.name] = $(this).is(':checked');
                });

            }
            if (opts.data) opts.data = JSON.stringify(opts.data);

            var token = localStorage.getItem('token');
            $.ajax({
                type: opts.type || 'POST',
                url: url,
                contentType: 'application/json; charset=utf-8',
                data: opts.data || '',
                dataType: opts.dataType || 'json',
                headers: {
                    "Authorization": 'Bearer ' + token
                },
            }).done(function (gelen) {
                if (typeof (opts.loading) === "undefined" || opts.loading) {
                    Sys.unblockUI();
                }
                if (opts.element) {
                    if (opts.dataType == 'html') {
                        $(opts.element).html(gelen);
                    } else {
                        $(opts.element).html(gelen.Data);
                    }
                    $(opts.element).show();
                }
                if (gelen.Status) {
                    if (gelen.Status === 1) {
                        //Basarili
                        if (typeof (opts.noty) === "undefined" || opts.noty) {
                            Sys.Noty(gelen.Message, "", "success");
                        }
                    } else {
                        //Basarisiz
                        if (typeof (opts.noty) === "undefined" || opts.noty) {
                            Sys.Noty(gelen.Message, "", "error");
                        }
                    }
                }
                if (opts.element) {
                    $(opts.element).html(gelen);
                    $(opts.element).show();
                }

                if (jQuery.isFunction(sonuc)) {
                    sonuc(gelen);
                    return;
                }

            });
        },
    }
}();

String.format = function () {
    var s = arguments[0];
    for (var i = 0; i < arguments.length - 1; i++) {
        var reg = new RegExp("\\{" + i + "\\}", "gm");
        s = s.replace(reg, arguments[i + 1]);
    }

    return s;
}


// propery'ler


Object.extend = function (destination, source) {
    for (var property in source)
        destination[property] = source[property];
    return destination;
};

$.fn.serializeObject = function () {
    var o = {};
    var a = this.serializeArray();
    $.each(a, function () {
        if (o[this.name] !== undefined) {
            if (!o[this.name].push) {
                o[this.name] = [o[this.name]];
            }
            o[this.name].push(this.value || '');
        } else {
            o[this.name] = this.value || '';
        }
    });
    return o;
};




$(function () {
    $.ajaxSetup({
        error: function (jqXHR, exception) {
            //console.log(jqXHR);
            //console.log(exception);
            //TODO: select2'de Ã§ok sayÄ±da ajax isteÄi gÃ¶nderildiÄinde istek abort oluyor ve exception'a dÃ¼ÅÃ¼yor.
            if (jqXHR.statusText !== 'abort')
                Sys.HandleError(jqXHR);
            //Sys.HandleError(jqXHR);
        }
    });
});



Sys = function () {
    var self = this;

    var isRTL = false;
    var isIE8 = false;
    var isIE9 = false;
    var isIE10 = false;
    var assetsPath = '';
    var globalImgPath = '/img/';

    if ($('body').css('direction') === 'rtl') {
        isRTL = true;
    }

    isIE8 = !!navigator.userAgent.match(/MSIE 8.0/);
    isIE9 = !!navigator.userAgent.match(/MSIE 9.0/);
    isIE10 = !!navigator.userAgent.match(/MSIE 10.0/);


    this.loadingCount = 0;


    if (isIE10) {
        $('html').addClass('ie10'); // detect IE10 version
    }

    if (isIE10 || isIE9 || isIE8) {
        $('html').addClass('ie'); // detect IE10 version
    }


    return {

        init: function () {

        },

        getGlobalImgPath: function () {
            return assetsPath + globalImgPath;
        },


        HandleError: function (jqXHR) {

            //console.log(jqXHR);

            Sys.unblockUI();


            if (jqXHR.status === 407) {
                var gelen = jQuery.parseJSON(jqXHR.responseText);
                Sys.Alert(gelen.Message, 'HATA!');
                setTimeout(function () {
                    location.href = gelen.Value;
                }, 3000);

            } else if (jqXHR.status === 405 || jqXHR.status === 417) {

                var reponse = jQuery.parseJSON(jqXHR.responseText);
                Sys.Alert({ message: reponse.Message, title: 'HATA!' });

            } else if (jqXHR.status === 404) {

                Sys.Alert({ message: 'Sayfa bulunamadÄ±.', title: 'HATA!' });

            } else if (jqXHR.status === 401) {
                localStorage.setItem("FullName", "Oturum AÃ§");
                Sys.Alert({ message: 'Oturumunuz sonlandÄ±. GiriÅ sayfasÄ±na yÃ¶nlendiriliyorsunuz...', title: 'UYARI!' });
                setTimeout(function () {
                    location.href = '/Anasayfa';
                }, 3000);

            } else if (jqXHR.status === 600) {
                Sys.Noty('GirdiÄiniz bilgileri kontrol ediniz', "", "error");
            } else {
                Sys.Alert({ message: 'Beklenmeyen bir hata oluÅtu lÃ¼tfen daha sonra tekrar deneyiniz.', title: 'HATA!' });
            }
        },

        Window: function (opts) {
            if (!opts)
                throw "HatalÄ± parametre en az url gÃ¶nderilmelidir.";


            if (!opts.width) opts.width = 800;
            if (!opts.height) opts.height = 800;
            opts.title = opts.title || "Window";


            var left = (screen.width / 2) - (opts.width / 2);
            var top = (screen.height / 2) - (opts.height / 2);

            window.open(opts.url, opts.title, "width=" + opts.width + ", height=" + opts.height + ", top=" + top + ", left=" + left + ",scrollbars=yes");

        },

        // alert
        Alert: function (options) {
            options = $.extend(true, {
                title: options.title | "",
                message: '{uyarÄ± yok}'
            }, options);


            var alertModal = '<div class="modal fade" role="alert">' +
                '<div class="modal-dialog">' +
                '<div class="modal-content">' +
                '<div class="modal-header">' +
                '<h4 class="modal-title">{0}</h4>' +
                '<button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                '{1}' +
                '</div>' +
                '<div class="modal-footer">' +
                '<button type="button" class="btn btn-danger" data-dismiss="modal">KAPAT</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';

            $(String.format(alertModal, options.title, options.message)).modal();
        },



        // noty
        Noty: function (msg, title, type) {
            if (!type) type = "success";

            // Sadece bu dort ana tip toaster mesaj turu olarak kullanilacak
            const allowed = new Set(['success', 'info', 'warning', 'error']);

            // supheli veya bos bir deger gelirse success olarak don veya boÅ bir deÄer gelirse 'success'e dÃ¼Å
            const safeType = allowed.has(type) ? type : 'success';

            toastr.options = {
                "closeButton": false,
                "debug": false,
                "newestOnTop": false,
                "progressBar": false,
                "positionClass": "toast-top-right",
                "preventDuplicates": false,
                "onclick": null,
                "showDuration": "300",
                "hideDuration": "1000",
                "timeOut": "5000",
                "extendedTimeOut": "1000",
                "showEasing": "swing",
                "hideEasing": "linear",
                "showMethod": "fadeIn",
                "hideMethod": "fadeOut"
            }


            //toastr[type](msg, title)
            toastr[safeType](msg, title);
            return;
            new PNotify({
                title: title,
                text: msg,
                type: 'success',
                shadow: true
            });

            return;
            noty({
                text: title + msg,
                type: type,
                layout: 'bottomRight',
                timeout: 5000,
                maxVisible: 10,
                closeWith: ['click']
            });

        },
        notific8: function (message, settings) {

            //settings = $.extend(true, {
            //    heading: '',
            //    theme: ''
            //}, settings);


            //var settings = {
            //    //theme: 'teal',
            //    //sticky: true,
            //    heading: title,
            //    //horizontalEdge: $('select#notific8horizontal').val(),
            //    //verticalEdge: $('select#notific8vertical').val()
            //};
            //     $button = $(this);

            //if ($.trim($('input#notific8Heading').val()) != '') {
            //    settings.heading = $.trim($('input#notific8Heading').val());
            //}

            //if (!settings.sticky) {
            //    settings.life = $('select#notific8Life').val();
            //}

            $.notific8(message, settings);
        },
        blockUI: function (options) {

            self.loadingCount++;
            if (self.loadingCount == 1) {

                options = $.extend(true, {
                    boxed: true
                }, options);

                var html = '';
                if (options.animate) {
                    html = '<div class="loading-message ' + (options.boxed ? 'loading-message-boxed' : '') + '">' + '<div class="block-spinner-bar"><div class="bounce1"></div><div class="bounce2"></div><div class="bounce3"></div></div>' + '</div>';
                } else if (options.iconOnly) {
                    html = '<div class="loading-message ' + (options.boxed ? 'loading-message-boxed' : '') + '"><img src="' + this.getGlobalImgPath() + 'loading-spinner-grey.gif" align=""></div>';
                } else if (options.textOnly) {
                    html = '<div class="loading-message ' + (options.boxed ? 'loading-message-boxed' : '') + '"><span>&nbsp;&nbsp;' + (options.message ? options.message : 'LÃ¼tfen Bekleyiniz') + '</span></div>';
                } else {
                    html = '<div class="loading-message ' + (options.boxed ? 'loading-message-boxed' : '') + '"><img src="' + this.getGlobalImgPath() + 'loading-spinner-grey.gif" align=""><span>&nbsp;&nbsp;' + (options.message ? options.message : 'YÃKLENÄ°YOR...') + '</span></div>';
                }

                if (options.target) { // element blocking
                    var el = $(options.target);
                    if (el.height() <= ($(window).height())) {
                        options.cenrerY = true;
                    }
                    el.block({
                        message: html,
                        baseZ: options.zIndex ? options.zIndex : 99000,
                        centerY: options.cenrerY !== undefined ? options.cenrerY : false,
                        css: {
                            top: '10%',
                            border: '0',
                            padding: '0',
                            backgroundColor: 'none'
                        },
                        overlayCSS: {
                            backgroundColor: options.overlayColor ? options.overlayColor : '#555',
                            opacity: options.boxed ? 0.05 : 0.1,
                            cursor: 'wait'
                        }
                    });
                } else { // page blocking
                    $.blockUI({
                        message: html,
                        baseZ: options.zIndex ? options.zIndex : 99000,
                        css: {
                            border: '0',
                            padding: '0',
                            backgroundColor: 'none'
                        },
                        overlayCSS: {
                            backgroundColor: options.overlayColor ? options.overlayColor : '#555',
                            opacity: options.boxed ? 0.05 : 0.1,
                            cursor: 'wait'
                        }
                    });
                }

                // bitiÅ
            }
        },


        //screen unblock
        unblockUI: function (target) {
            self.loadingCount--;
            if (self.loadingCount == 0) {
                if (target) {
                    $(target).unblock({
                        onUnblock: function () {
                            $(target).css('position', '');
                            $(target).css('zoom', '');
                        },
                        fadeOut: 200
                    });
                } else {
                    $.unblockUI({ fadeOut: 200 });
                }


            }
        },


        // ajax
        Ajax: function (url, opts, sonuc) {

            if (!opts) opts = {};

            if (typeof (opts.loading) === "undefined" || opts.loading) {
                Sys.blockUI(opts.loadingMsg);
            }

            if (opts.element) {
                $(opts.element).empty();
                $(opts.element).hide();
            }


            if (opts.form) {
                if (!opts.data) opts.data = {};
                opts.data = Object.extend(opts.data, $(opts.form).serializeObject());

                $.each($(opts.form + ' input[type=checkbox]'), function (index, eleme) {
                    opts.data[this.name] = $(this).is(':checked');
                });

            }
            //if (opts.data) opts.data = JSON.stringify(opts.data);

            var token = localStorage.getItem('token');

            $.ajax({
                type: opts.type || 'POST',
                url: url,
                //contentType: "application/json; charset=utf-8",
                data: opts.data || '',
                dataType: opts.dataType || 'json',
                headers: {
                    "Authorization": 'Bearer ' + token
                }
            }).done(function (gelen) {

                if (typeof (opts.loading) === "undefined" || opts.loading) {
                    Sys.unblockUI();
                }

                if (opts.element) {
                    if (opts.dataType == 'html') {
                        $(opts.element).html(gelen);
                    } else {
                        $(opts.element).html(gelen.Data);
                    }
                    $(opts.element).show();
                }

                if (gelen.status == 1) {
                    //Basarili
                    if (typeof (opts.noty) === "undefined" || opts.noty) {
                        Sys.Noty(gelen.Message);
                    }
                } else {
                    //Basarisiz
                    if (typeof (opts.alert) === "undefined" || opts.noty) {
                        Sys.Alert({ message: gelen.Message });
                    }
                }


                if (opts.element) {
                    $(opts.element).html(gelen.Data);
                    $(opts.element).show();
                }

                if (jQuery.isFunction(sonuc)) {
                    sonuc(gelen);
                    return;
                }




            });
        },


        ///
        FillYillar: function (element, baslangicYili, bitisYili) {
            var aktifYil;

            /*
            // yÄ±lÄ± server bilgisayardan al
            Sys.Ajax('/common/getCurrentTime', {noty:false,loading:false}, function (e) {
                var d = eval(e.replace(/\/Date\((\d+)\)\//gi, "new Date($1)"));
                aktifYil = d.getFullYear();
            });
            */
            aktifYil = new Date().getFullYear(); // yÄ±lÄ± client bilgisayardan al 

            if (!baslangicYili) baslangicYili = aktifYil;
            if (!bitisYili) bitisYili = aktifYil;
            var data = [];

            for (var i = bitisYili; i >= baslangicYili; i--) {
                data.push({
                    Id: i,
                    Ad: i
                });
            }

            Sys.FillComboData(element, data);
        },

        ///
        FillCombo: function (opts) {

            Sys.Ajax(opts.url, { data: opts.data, loading: false, noty: false }, function (e) {
                Sys.FillComboData(opts.element, e);
            });

            if (opts.cascadeElement) {
                $(opts.element).change(function () {
                    var Id = $(this).val();

                    Sys.Ajax(opts.cascadeUrl, { data: { Id: Id }, loading: false, noty: false }, function (e) {
                        Sys.FillComboData(opts.cascadeElement, e);
                    });
                });
            }
        },

        ///
        FillComboData: function (element, data) {
            $(element).empty();
            $.each(data, function (index, value) {
                $(element).append('<option value="' + value.Id + '">' + value.Name + '</option>');
            });
        },

        timeConverter: function (UNIX_timestamp) {
            var a = new Date(UNIX_timestamp * 1000);
            var hour = a.getUTCHours();
            var min = a.getUTCMinutes();
            var sec = a.getUTCSeconds();
            var time = hour + ':' + min + ':' + sec;
            return a.toISOString();
        },
        //
        ReCalculateTimes: function () {
            $('abbr').each(function (index, el) {
                var date = $(el).attr("data-time");
                var tarih = moment(date)//moment.unix(date).local().toDate();
                if (isNaN(tarih) == false) {
                    //var tarih = moment(Sys.timeConverter(date));
                    $(el).attr("title", moment(tarih).format('DD MMMM YYYY dddd, HH:mm')).text(moment(tarih).fromNow());
                }
            });
        },

        //
        getUrlParameter: function (name) {
            name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
            var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
                results = regex.exec(location.search);
            return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
        },

        //
        jsonToDate: function (date, format) {
            return moment(date).format(format);
        },
        playSound: function (soundName) {
            path = "/assets/media/sounds/";
            if (!soundName) {
                path += 'bip.mp3';
            } else {
                path += soundName;
            }

            new Audio(path).play();
        },

        findObjectByKey: function (array, key, value) {
            for (var i = 0; i < array.length; i++) {
                if (array[i][key] === value) {
                    return array[i];
                }
            }
            return null;
        },

        getUnixTime: function () {
            return (new Date).getTime();
        },

        numberWithCommas: function (x) {
            var parts = x.toString().split(".");
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            return parts.join(",");

            //x = x.toString();
            //var pattern = /(-?\d+)(\d{3})/;
            //while (pattern.test(x))
            //    x = x.replace(pattern, "$1,$2");
            //return x;
        },
        numberFormat: function (number, decimals, dec_point, thousands_sep) {
            var n = !isFinite(+number) ? 0 : +number,
                prec = !isFinite(+decimals) ? 2 : Math.abs(decimals),
                sep = (typeof thousands_sep === 'undefined') ? '.' : thousands_sep,
                dec = (typeof dec_point === 'undefined') ? ',' : dec_point,
                toFixedFix = function (n, prec) {
                    // Fix for IE parseFloat(0.55).toFixed(0) = 0;
                    var k = Math.pow(10, prec);
                    return Math.round(n * k) / k;
                },
                s = (prec ? toFixedFix(n, prec) : Math.round(n)).toString().split('.');
            if (s[0].length > 3) {
                s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
            }
            if ((s[1] || '').length < prec) {
                s[1] = s[1] || '';
                s[1] += new Array(prec - s[1].length + 1).join('0');
            }
            return s.join(dec);
        }

    }

}();

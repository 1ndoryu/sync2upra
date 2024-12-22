<div style='display: flex; justify-content: center; align-items: center; width: 100%; text-align: center;'>
    <p>2upra</p>
    <img src="/build/icon.png" width=30 height=30/>
</div>

```js
    // Svg de residuo que no se que hace sinceramente.
    const secondIconDiv = document.createElement("div");
    secondIconDiv.className = "second-icon-container";
    const svgIcon2 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgIcon2.setAttribute("data-testid", "geist-icon");
    svgIcon2.setAttribute("height", "16");
    svgIcon2.setAttribute("width", "16");
    svgIcon2.setAttribute("viewBox", "0 0 16 16");
    svgIcon2.setAttribute("stroke-linejoin", "round");
    svgIcon2.setAttribute("style", "color: currentcolor");
    svgIcon2.innerHTML = `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.5607 3.99999L15.0303 4.53032L6.23744 13.3232C5.55403 14.0066 4.44599 14.0066 3.76257 13.3232L4.2929 12.7929L3.76257 13.3232L0.969676 10.5303L0.439346 9.99999L1.50001 8.93933L2.03034 9.46966L4.82323 12.2626C4.92086 12.3602 5.07915 12.3602 5.17678 12.2626L13.9697 3.46966L14.5 2.93933L15.5607 3.99999Z" fill="currentColor"></path>`;
    secondIconDiv.appendChild(svgIcon2);
    containerDiv.appendChild(secondIconDiv);
```
